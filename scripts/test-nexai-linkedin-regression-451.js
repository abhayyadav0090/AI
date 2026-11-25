'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const R = require('../lib/nexai-reliability.js');
const T = require('../public/chat-tasks.js');
const ROOT = path.join(__dirname, '..');

function makeQuery(doc) {
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    async lean() { return doc ? JSON.parse(JSON.stringify(doc)) : null; },
    then(resolve, reject) { return Promise.resolve(doc ? JSON.parse(JSON.stringify(doc)) : null).then(resolve, reject); },
  };
}

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    children: [],
    listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    querySelectorAll(sel) {
      const cls = sel.startsWith('.') ? sel.slice(1) : sel;
      return this.children.filter(c => c.className && c.className.split(/\s+/).includes(cls));
    },
    remove() {},
  };
  return el;
}

(async function main() {
  // ── 1) Investigation A: Syntactic truncation detection across all cutoff modes ──
  assert.equal(R.looksSyntacticallyTruncated('LinkedIn is a platform (J'), true, 'mid-word inside paren detected');
  assert.equal(R.looksSyntacticallyTruncated('Key uses include:\n- **'), true, 'mid-markdown bold bullet detected');
  assert.equal(R.looksSyntacticallyTruncated('1. **Job Search**\n\nApply to roles regularly,\n'), true, 'mid-sentence trailing comma detected');
  assert.equal(R.looksSyntacticallyTruncated('2. **Overview**\n\n- Connect with peers (such as '), true, 'mid-phrase trailing open paren detected');
  assert.equal(R.looksSyntacticallyTruncated('```js\nconst x = 1;\n// unclosed'), true, 'unclosed code fence detected');
  assert.equal(R.looksSyntacticallyTruncated('1. **Career Growth'), true, 'unclosed inline bold heading detected');

  // Complete responses must NEVER trigger false syntactic truncation
  assert.equal(R.looksSyntacticallyTruncated('LinkedIn is a professional networking platform used for career growth, hiring, and industry learning.'), false, 'complete prose must not trigger truncation');
  assert.equal(R.looksSyntacticallyTruncated('Yes (see details).'), false, 'closed paren sentence must not trigger truncation');
  assert.equal(R.looksSyntacticallyTruncated('Here are 3 things:\n1. Apple\n2. Banana\n3. Cherry'), false, 'complete short numbered list must not trigger truncation');

  // Stream recovery when HTTP chunked stream closes with missing finishReason OR mid-word "(J"
  {
    let calls = 0;
    const chunks = [];
    const timings = {};
    const recovered = await R.streamWithAutoContinuation({
      askStream: async ({ onText, timings: t }) => {
        calls++;
        if (calls === 1) {
          onText('LinkedIn is a professional networking platform (J');
          // Deliberately omit t.finishReason to simulate silent premature EOF
          t.sawFinishReason = false;
          return 'LinkedIn is a professional networking platform (J';
        }
        onText('(Job search and career networking). It connects professionals worldwide.');
        t.finishReason = 'STOP';
        t.sawFinishReason = true;
        return '(Job search and career networking). It connects professionals worldwide.';
      },
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'what it is' }] }],
      onText: d => chunks.push(d),
      timings,
    });
    assert.equal(calls, 2, 'missing finishReason / mid-word "(J" triggers seamless continuation');
    assert.equal(recovered.incomplete, false);
    assert.ok(recovered.text.includes('professional networking platform'));
    assert.ok(recovered.text.includes('career networking'));
  }

  // If recovery ALSO terminates cleanly with "- **" even after STOP, NEVER mark it complete!
  {
    const exhausted = await R.streamWithAutoContinuation({
      askStream: async ({ onText, timings: t }) => {
        onText('Main uses of LinkedIn:\n- **');
        t.finishReason = 'STOP';
        t.sawFinishReason = true;
        return 'Main uses of LinkedIn:\n- **';
      },
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'linkedin' }] }],
      maxContinuations: 1,
      onText() {},
      timings: {},
    });
    assert.equal(exhausted.incomplete, true, 'response stuck at "- **" must NEVER be marked complete');
    assert.ok(exhausted.text.includes('maximum output length') || exhausted.incompleteReason);
  }

  // Short complete reply must NOT trigger continuation
  {
    let calls = 0;
    const shortRes = await R.streamWithAutoContinuation({
      askStream: async ({ onText, timings: t }) => {
        calls++;
        onText('1. Focus\n2. Consistency\n3. Rest');
        t.finishReason = 'STOP';
        t.sawFinishReason = true;
        return '1. Focus\n2. Consistency\n3. Rest';
      },
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'hello 3 things, anything' }] }],
      onText() {},
      timings: {},
    });
    assert.equal(calls, 1, 'complete short response never runs continuation');
    assert.equal(shortRes.incomplete, false);
  }

  // ── 2) Investigation B: Conversation context & exact 4-message LinkedIn script ──
  assert.equal(R.isDeicticFollowUp('what it is'), true);
  assert.equal(R.isDeicticFollowUp('what is it'), true);
  assert.equal(R.isDeicticFollowUp('explain'), true);
  assert.equal(R.isDeicticFollowUp('in detail'), true);
  assert.equal(R.isDeicticFollowUp('why'), true);
  assert.equal(R.isDeicticFollowUp('What is LinkedIn? Explain in detail.'), false);
  assert.equal(R.isDeicticFollowUp('Explain photosynthesis'), false);
  assert.equal(R.isBareTopicPrompt('linkedin'), true);
  assert.equal(R.isBareTopicPrompt('hi'), false);

  // End-to-end HTTP + SSE test of exact 4-turn conversation through real server.js!
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-regression-secret';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-mocked-fetch';
  const userId = '507f1f77bcf86cd799439022';
  const chatId = '507f1f77bcf86cd799439033';
  const savedChats = new Map();
  const capturedGeminiBodies = [];

  const origFetch = global.fetch;
  const app = require('../server.js');
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  mongoose.models.User.findById = () => makeQuery({ _id: userId, email: 'nexai@nexos.test', name: 'Tester' });
  mongoose.models.Chat.findOne = (filter) => makeQuery(savedChats.get(String(filter._id)) || null);
  mongoose.models.Chat.updateOne = async (filter, update) => {
    const c = savedChats.get(String(filter._id));
    if (c && update.$push?.messages?.$each) {
      c.messages.push(...update.$push.messages.$each);
      c.updatedAt = new Date();
    }
    return { acknowledged: true };
  };
  // Intercept Chat.prototype.save cleanly for new chats
  const origChatSave = mongoose.models.Chat.prototype.save;
  mongoose.models.Chat.prototype.save = async function () {
    this._id = chatId;
    this.updatedAt = new Date();
    savedChats.set(String(this._id), { _id: this._id, userId, title: this.title, messages: [...this.messages], updatedAt: this.updatedAt });
    return this;
  };
  mongoose.models.Chat.find = () => makeQuery([]);

  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookie = `token=${token}`;
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const urlBase = `http://127.0.0.1:${server.address().port}`;

  // Helper to read real SSE /api/chat response
  async function postChatSse(payload) {
    global.fetch = async (url, init) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        const body = JSON.parse(init.body);
        capturedGeminiBodies.push(body);
        const userText = body.contents[body.contents.length - 1]?.parts?.[0]?.text || '';
        const encoder = new TextEncoder();
        // Turn 2 simulates broken SSE stream ending mid-word "(J" WITHOUT finishReason first, then clean continuation!
        let sseChunks;
        if (userText === 'what it is' && capturedGeminiBodies.filter(b => b.contents.at(-1)?.parts?.[0]?.text === 'what it is').length === 1) {
          sseChunks = [
            'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'LinkedIn is a professional networking platform (J' }] } }] }) + '\n\n',
          ];
        } else if (userText.includes('Continue seamlessly from the exact point')) {
          sseChunks = [
            'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '(Job search, recruiter outreach, and industry updates). Professionals use it to showcase experience and connect with peers.' }] }, finishReason: 'STOP' }] }) + '\n\n',
          ];
        } else {
          const reply = [
            'LinkedIn is a professional networking platform designed for career development and hiring.',
            '',
            '1. **Job Search & Internships**',
            '',
            'Browse openings, apply directly, and connect with hiring managers.',
            '',
            '2. **Content Sharing & Learning**',
            '',
            'Publish posts, read industry updates, and learn from peers.',
            '',
            '3. **Upskilling & Knowledge**',
            '',
            'Follow topics and take courses aligned with career goals.',
          ].join('\n');
          sseChunks = [
            'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] }) + '\n\n',
          ];
        }
        return new Response(new ReadableStream({
          start(controller) {
            sseChunks.forEach(c => controller.enqueue(encoder.encode(c)));
            controller.close();
          },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return origFetch(url, init);
    };

    const res = await origFetch(urlBase + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...payload, stream: true }),
    });
    assert.equal(res.status, 200);
    const rawSse = await res.text();
    let answer = '', done = null;
    for (const block of rawSse.split(/\r?\n\r?\n/)) {
      const evLine = block.split('\n').find(l => l.startsWith('event:'));
      const dataLine = block.split('\n').find(l => l.startsWith('data:'));
      if (!evLine || !dataLine) continue;
      const ev = evLine.slice(6).trim();
      const d = JSON.parse(dataLine.slice(5).trim());
      if (ev === 'delta') answer += d.text;
      if (ev === 'done') done = d;
    }
    return { answer, done };
  }

  try {
    // Run exact 4-message LinkedIn conversation:
    const t1 = await postChatSse({ message: 'linkedin' });
    assert.equal(t1.done.incomplete, false);
    assert.ok(capturedGeminiBodies[0].systemInstruction.parts[0].text.includes('TOPIC CLARITY'));

    const t2 = await postChatSse({ chatId: t1.done.chatId, message: 'what it is' });
    assert.equal(t2.done.incomplete, false, 'Mid-word "(J" premature SSE drop auto-recovered cleanly!');
    assert.ok(!t2.answer.trim().endsWith('(J'), 'Truncated ending recovered seamlessly');
    assert.ok(t2.answer.includes('professional networking platform'), 'Completed answer coherent');
    // Verify context anchor referenced LinkedIn for "what it is"
    const turn2Req = capturedGeminiBodies.find(b => b.contents.at(-1)?.parts?.[0]?.text === 'what it is');
    assert.ok(turn2Req.systemInstruction.parts[0].text.includes('FOLLOW-UP CONTEXT') && /linkedin/i.test(turn2Req.systemInstruction.parts[0].text));

    const t3 = await postChatSse({ chatId: t1.done.chatId, message: 'linkedin' });
    assert.equal(t3.done.incomplete, false);

    const t4 = await postChatSse({ chatId: t1.done.chatId, message: 'what is it' });
    assert.equal(t4.done.incomplete, false);
    const turn4Req = capturedGeminiBodies.find(b => b.contents.at(-1)?.parts?.[0]?.text === 'what is it');
    assert.ok(turn4Req.systemInstruction.parts[0].text.includes('FOLLOW-UP CONTEXT') && /linkedin/i.test(turn4Req.systemInstruction.parts[0].text));
  } finally {
    global.fetch = origFetch;
    mongoose.models.Chat.prototype.save = origChatSave;
    await new Promise(r => server.close(r));
  }

  // ── 3) Investigation C: Action suggestion accuracy & Save-as-note suppression ──
  const linkedInInfo = [
    'LinkedIn is a professional networking platform used by professionals and recruiters.',
    '',
    '1. **Job Search & Internships**',
    '',
    'Find openings and apply directly.',
    '',
    '2. **Content Sharing & Learning**',
    '',
    'Share insights and follow industry leaders.',
    '',
    '3. **Upskilling & Knowledge**',
    '',
    'Learn new career skills.',
  ].join('\n');

  const adviceBullets = [
    'LinkedIn is a professional networking platform. Common ways people use it include:',
    '1. **Build Your Profile** — Highlight experience and projects.',
    '2. **Connect With Peers** — Grow your professional network due to industry referrals.',
    '3. **Track Career Milestones** — Stay updated with mentors.',
  ].join('\n');

  const checkAttach = (replyText, userMsg, extraCtx = {}) => {
    const origDoc = global.document;
    global.document = {
      getElementById: () => ({}),
      createElement: (tag) => makeFakeElement(tag),
      head: { appendChild() {} },
    };
    try {
      const bubble = makeFakeElement('div');
      T.attach(bubble, replyText, userMsg, {
        today: () => '2026-11-26',
        toast() {},
        say() {},
        addTasks: () => ({ added: 0 }),
        addHabits: () => ({ added: 0 }),
        addNote: () => ({ added: 0 }),
        ...extraCtx,
      });
      const actionBar = bubble.querySelectorAll('.nx-addtasks')[0];
      const buttons = actionBar ? actionBar.children.map(b => b.textContent) : [];
      const incompleteBars = bubble.querySelectorAll('.nx-incomplete-bar');
      return { bubble, buttons, incompleteCount: incompleteBars.length };
    } finally {
      global.document = origDoc;
    }
  };

  for (const prompt of ['linkedin', 'what it is', 'what is it', 'What is LinkedIn? Explain in detail.', 'Explain LinkedIn in 3 sections with examples.', 'hello 3 things, anything']) {
    for (const reply of [linkedInInfo, adviceBullets]) {
      const ui = checkAttach(reply, prompt);
      assert.deepEqual(ui.buttons, [], `No fake task or note chips for "${prompt}"`);
    }
  }

  // Explicit informational list with "Examples" must NOT generate tasks
  const threeThings = 'Here are 3 interesting things:\n1. Honey never spoils.\n2. Octopuses have three hearts.\n3. Bananas are berries.';
  assert.deepEqual(checkAttach(threeThings, 'hello 3 things, anything').buttons, [], 'hello 3 things must produce zero action chips');

  // Explain this in detail must NOT produce tasks or Save as note
  assert.deepEqual(checkAttach(linkedInInfo, 'Explain this in detail').buttons, [], 'Explain this in detail must produce zero action chips');

  // Incomplete reply MUST NEVER show action chips or Save as note, only Incomplete bar + Continue!
  const explicitTruncatedPlan = 'Action plan for your week:\n1. Update your LinkedIn headline\n2. Apply to three roles\n3. Draft outreach message,';
  const incUi = checkAttach(explicitTruncatedPlan, 'give me an action plan for my week', { incomplete: true, incompleteReason: 'MAX_TOKENS', onContinue() {} });
  assert.equal(incUi.incompleteCount, 1, 'Incomplete bar must render');
  assert.deepEqual(incUi.buttons, [], 'Incomplete reply must generate zero task/habit/note action chips');

  // Explicit task requests DO create task action chips cleanly (without unrequested Save as note!)
  const explicitCompletePlan = 'Action plan for your week:\n1. Update your LinkedIn headline (high priority)\n2. Apply to three roles due 2026-11-30\n3. Draft outreach message';
  const taskUi = checkAttach(explicitCompletePlan, 'create 3 tasks for my job search');
  assert.deepEqual(taskUi.buttons, ['＋ Add 3 tasks'], 'Explicit task plan shows ＋ Add 3 tasks cleanly without unsolicited Save as note');

  // Intentional note requests still work
  const noteDraftUi = checkAttach(linkedInInfo, 'draft study notes on LinkedIn');
  assert.deepEqual(noteDraftUi.buttons, ['Save as note'], 'Explicit note draft request offers Save as note when complete');

  let directSaved = 0;
  assert.equal(T.tryDirectAdd('save this as a note', linkedInInfo, {
    today: () => '2026-11-26',
    toast() {},
    say() {},
    addNote: () => { directSaved++; return { added: 1 }; },
    addTasks: () => ({ added: 0 }),
    addHabits: () => ({ added: 0 }),
  }), true);
  assert.equal(directSaved, 1, 'Intentional "save this as a note" command still saves complete replies');

  console.log('NexAI LinkedIn conversation, truncation, context & action regression tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
