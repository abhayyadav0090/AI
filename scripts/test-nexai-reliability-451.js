'use strict';
// NexOS 4.5.1: NexAI reliability, MAX_TOKENS auto-continuation, overlap deduplication,
// incomplete-response UI guards, and strict actionable task extraction tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../lib/nexai-reliability.js');
const T = require('../public/chat-tasks.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  // 1) Continuation & bug-report intent detection
  ['continue', 'Continue please', 'go on', 'aage batao', 'poora karo', 'continue from where you left off'].forEach((m) => {
    assert.equal(R.isContinuationMessage(m), true, 'continuation: ' + m);
  });
  ['continue learning JavaScript by building projects every single day for a month', 'how do I continue?', 'explain recursion'].forEach((m) => {
    assert.equal(R.isContinuationMessage(m), false, 'not continuation: ' + m);
  });
  ["it's bug", 'its a bug', 'incomplete response', 'your reply got cut off', 'adhoora jawab'].forEach((m) => {
    assert.equal(R.isBugOrTruncatedReport(m), true, 'bug report: ' + m);
  });
  assert.equal(R.isBugOrTruncatedReport('Write a LinkedIn post about productivity'), false);

  // 2) Overlap trimming & streaming overlap filter
  {
    const a = 'Here are three ways to grow on LinkedIn:\n\n1. Optimize your headline with clear outcomes';
    const b = '1. Optimize your headline with clear outcomes\n2. Share concise weekly lessons.';
    const res = R.trimContinuationOverlap(a, b);
    assert.ok(!res.text.includes('Optimize your headline'), 'duplicate line must be stripped');
    assert.ok(res.text.includes('2. Share concise weekly lessons.'), 'new line must remain');
  }
  {
    const a = 'Photosynthesis occurs inside the chloropl';
    const b = 'chloroplasts using sunlight.';
    const res = R.trimContinuationOverlap(a, b);
    assert.equal(res.text, 'asts using sunlight.');
  }
  {
    const a = '## Section One\n\nWrite clear posts that help your target audience.\n\n## Section Two\n\nEngage genuinely in comments every day.';
    const b = '## Section Two\n\nEngage genuinely in comments every day.\n\n## Section Three\n\nTrack what resonates.';
    const res = R.trimContinuationOverlap(a, b);
    assert.ok(!res.text.includes('## Section Two'), 'repeated heading/paragraph stripped');
    assert.ok(res.text.includes('## Section Three'));
  }
  {
    const emitted = [];
    const filter = R.createStreamOverlapFilter('First paragraph ends cleanly.\n\nSecond paragraph starts here.', (d) => emitted.push(d), { bufferLimit: 80 });
    filter.push('Second paragraph ');
    filter.push('starts here.\n\nThird paragraph continues ');
    filter.push('with fresh insight.');
    filter.flush();
    const joined = emitted.join('');
    assert.ok(!joined.includes('Second paragraph starts here.'), 'stream overlap filter must not emit duplicated prefix');
    assert.ok(joined.includes('Third paragraph continues with fresh insight.'));
  }

  // 3) streamWithAutoContinuation: MAX_TOKENS -> seamless auto-continuation
  {
    let calls = 0;
    const chunks = [];
    const timings = {};
    const askStream = async ({ onText, timings: t }) => {
      calls++;
      if (calls === 1) {
        onText('Part 1: LinkedIn headline tips.\n\n1. State who you help.');
        t.finishReason = 'MAX_TOKENS';
        return 'Part 1: LinkedIn headline tips.\n\n1. State who you help.';
      }
      onText('1. State who you help.\n2. Show measurable results.');
      t.finishReason = 'STOP';
      return '1. State who you help.\n2. Show measurable results.';
    };
    const out = await R.streamWithAutoContinuation({
      askStream,
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      onText: (d) => chunks.push(d),
      timings,
    });
    assert.equal(calls, 2);
    assert.equal(out.incomplete, false);
    assert.equal(out.continuations, 1);
    assert.equal(chunks.join('').match(/State who you help/g).length, 1, 'no duplicate point emitted');
    assert.ok(out.text.includes('2. Show measurable results.'));
  }

  // 4) streamWithAutoContinuation: bounded retries when MAX_TOKENS keeps hitting
  {
    let calls = 0;
    const chunks = [];
    const timings = {};
    const askStream = async ({ onText, timings: t }) => {
      calls++;
      const piece = `Segment ${calls}: ` + 'word '.repeat(20);
      onText(piece);
      t.finishReason = 'MAX_TOKENS';
      return piece;
    };
    const out = await R.streamWithAutoContinuation({
      askStream,
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'long' }] }],
      maxContinuations: 2,
      onText: (d) => chunks.push(d),
      timings,
    });
    assert.equal(calls, 3, 'initial + at most 2 auto-continuations');
    assert.equal(out.incomplete, true);
    assert.equal(out.incompleteReason, 'MAX_TOKENS');
    assert.ok(out.text.includes('maximum output length'));
  }

  // 5) streamWithAutoContinuation: no-progress guard prevents infinite/empty repetition
  {
    let calls = 0;
    const askStream = async ({ onText, timings: t }) => {
      calls++;
      const same = 'Repeated ending sentence that exceeds twelve characters.';
      onText(same);
      t.finishReason = 'MAX_TOKENS';
      return same;
    };
    const out = await R.streamWithAutoContinuation({
      askStream,
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'repeat' }] }],
      maxContinuations: 3,
      onText() {},
      timings: {},
    });
    assert.equal(calls, 2, 'stops immediately after duplicate no-progress continuation');
    assert.equal(out.incomplete, true);
  }

  // 6) streamWithAutoContinuation: SAFETY & mid-stream stall
  {
    const outSafety = await R.streamWithAutoContinuation({
      askStream: async ({ onText, timings: t }) => { onText('Partial'); t.finishReason = 'SAFETY'; return 'Partial'; },
      system: '', contents: [], onText() {}, timings: {},
    });
    assert.equal(outSafety.incomplete, true);
    assert.equal(outSafety.incompleteReason, 'SAFETY');

    const outStall = await R.streamWithAutoContinuation({
      askStream: async ({ onText, timings: t }) => { onText('Halfway'); t.partialReply = true; return 'Halfway'; },
      system: '', contents: [], onText() {}, timings: {},
    });
    assert.equal(outStall.incomplete, true);
    assert.equal(outStall.incompleteReason, 'STREAM_STALLED');
  }

  // 7) askWithAutoContinuation (non-streaming)
  {
    let n = 0;
    const res = await R.askWithAutoContinuation({
      askOnce: async () => (++n === 1
        ? { text: 'First half of explanation.', finishReason: 'MAX_TOKENS' }
        : { text: 'First half of explanation. Second half completed.', finishReason: 'STOP' }),
      system: '', contents: [{ role: 'user', parts: [{ text: 'explain' }] }],
    });
    assert.equal(res.incomplete, false);
    assert.equal(res.continuations, 1);
    assert.equal(res.text, 'First half of explanation. Second half completed.');
  }

  // 8) Chat-tasks strictness & incomplete note guard
  {
    const linkedinDraft = [
      'Here is a LinkedIn post draft for your launch:',
      '- Hook: Most teams overlook this simple habit',
      '- Body: We rebuilt our workflow from scratch',
      '- Hashtags: #productivity #buildinpublic',
      '- Tip: Post between 9 AM and 11 AM',
    ].join('\n');
    assert.deepEqual(T.extract(linkedinDraft, { today: '2026-11-25' }), [], 'LinkedIn post metadata must not be extracted as tasks');
    assert.equal(T.classify(linkedinDraft, 'write a linkedin post', 0), 'none');

    const inCode = 'Example:\n```md\n- Build a rocket\n- Launch tomorrow\n```\nHope this helps!';
    assert.deepEqual(T.extract(inCode, { today: '2026-11-25' }), [], 'bullets inside code blocks must not become tasks');

    const truncated = 'Action plan for your week:\n1. Update your LinkedIn headline\n2. Draft three case study posts\n3. Reach out to five mentors,';
    const items = T.extract(truncated, { today: '2026-11-25', incomplete: true });
    assert.deepEqual(items.map((x) => x.title), ['Update your LinkedIn headline', 'Draft three case study posts'], 'broken trailing bullet on incomplete reply is skipped');

    // Note saving blocked when reply is incomplete
    let notesSaved = 0;
    const msgs = [];
    const handled = T.tryDirectAdd('save this as a note', 'Long enough partial answer '.repeat(12) + R.TRUNCATED_REPLY_NOTE, {
      today: () => '2026-11-25',
      toast: (m) => msgs.push(m),
      say: (m) => msgs.push(m),
      addNote: () => { notesSaved++; return { added: 1 }; },
      addTasks: () => ({ added: 0 }),
      addHabits: () => ({ added: 0 }),
    });
    assert.equal(handled, true);
    assert.equal(notesSaved, 0, 'must not save incomplete response as a note');
    assert.ok(msgs.some((m) => /incomplete/i.test(m)));

    // Requested count in "add 3 tasks"
    let addedCount = 0;
    T.tryDirectAdd('add 3 tasks', 'Your plan:\n1. Write outline\n2. Edit draft\n3. Publish post\n4. Share link', {
      today: () => '2026-11-25',
      toast() {},
      say() {},
      addTasks: (list) => { addedCount = list.length; return { added: list.length }; },
      addHabits: () => ({ added: 0 }),
      addNote: () => ({ added: 0 }),
    });
    assert.equal(addedCount, 3, 'respects explicit count in "add 3 tasks"');
  }

  // 9) Server, Classic and Enterprise wiring checks
  const srv = read('server.js');
  const classic = read('public/app.js');
  const ent = read('public/index-redesign.html');
  assert.ok(!srv.includes("block !== 'MAX_TOKENS'"), 'server must no longer ignore MAX_TOKENS finishReason');
  assert.ok(srv.includes('streamWithAutoContinuation') && srv.includes('askWithAutoContinuation'), 'server must use auto-continuation');
  assert.ok(!srv.includes('For bug reports or feature requests, mention GitHub Issues'), 'server must not reflexively send bug reports to GitHub');
  assert.ok(srv.includes('do NOT deflect or send them to GitHub'), 'server must instruct NexAI to diagnose issues itself');
  assert.ok(srv.includes('incomplete: result.incomplete'), 'server must persist and emit incomplete status');
  assert.ok(srv.includes('result.text.slice(0, 60000)'), 'server persists long continued replies up to 60k chars');
  assert.ok(classic.includes('buffer.split(/\\r?\\n\\r?\\n/)') && ent.includes('buffer.split(/\\r?\\n\\r?\\n/)'), 'Classic and Enterprise SSE parsers handle LF and CRLF separators');
  assert.ok(classic.includes('lastReplyIncomplete') && classic.includes('continueClassicChat'), 'Classic handles incomplete replies and Continue');
  assert.ok(ent.includes('lastReplyIncomplete') && ent.includes('continueEnterpriseChat'), 'Enterprise handles incomplete replies and Continue');

  console.log('NexOS 4.5.1 NexAI reliability and task-extraction tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
