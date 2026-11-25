'use strict';
// NexOS 4.4.0: Study Studio answers from the whole material when it is small, related-keyword search when it is large,
// quizzes and flashcards (pure helpers, routes with an in-memory database, client wiring).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const S = require('../lib/study.js');

(async () => {
  // ---- pure helpers
  assert.deepStrictEqual([S.clampInt(99, 3, 10, 5), S.clampInt(-4, 3, 10, 5), S.clampInt('x', 3, 10, 5), S.clampInt(6.6, 3, 10, 5)], [10, 3, 5, 7]);
  const many = Array.from({ length: 100 }, (_, i) => ({ idx: i }));
  const picked = S.sampleChunks(many, 10);
  assert.strictEqual(picked.length, 10); assert.strictEqual(picked[0].idx, 0); assert.ok(picked[9].idx >= 90 && picked.every((c, i) => !i || c.idx > picked[i - 1].idx), 'spread evenly, in order');
  assert.strictEqual(S.sampleChunks(many.slice(0, 5), 10).length, 5); assert.deepStrictEqual(S.sampleChunks(null, 3), []);
  assert.deepStrictEqual(S.parseKeywords('Sure: ' + JSON.stringify(['Chlorophyll', ' light ', 7, '', 'x'.repeat(60)]) + ' done'), ['chlorophyll', 'light']);
  assert.deepStrictEqual(S.parseKeywords('no list'), []); assert.deepStrictEqual(S.parseKeywords('[broken'), []);

  const good = { question: ' Where? ', options: ['A1', 'B1', 'C1', 'D1'], answer: 2, explanation: 'Because.', source: 2 };
  const quizText = '```json\n' + JSON.stringify({ questions: [good,
    { question: 'few options', options: ['a', 'b', 'c'], answer: 0 },
    { question: 'dup options', options: ['a', 'A', 'c', 'd'], answer: 0 },
    { question: 'bad answer', options: ['a', 'b', 'c', 'd'], answer: 4 },
    { question: 'text answer', options: ['a', 'b', 'c', 'd'], answer: '3', source: 99 },
    { question: '', options: ['a', 'b', 'c', 'd'], answer: 0 },
    { question: 'empty option', options: ['a', '', 'c', 'd'], answer: 0 }] }) + '\n```';
  const qs = S.parseQuiz(quizText, 3);
  assert.deepStrictEqual(qs.map((q) => q.question), ['Where?', 'text answer'], 'only well-formed questions survive');
  assert.deepStrictEqual([qs[0].answer, qs[0].source, qs[1].answer, qs[1].source], [2, 2, 3, null], 'bad source numbers are dropped');
  assert.deepStrictEqual(S.parseQuiz('nothing', 3), []);
  const sh = S.shuffleOptions({ options: ['a', 'b', 'c', 'd'], answer: 2 }, () => 0);
  assert.strictEqual(sh.options[sh.answer], 'c', 'the right option stays right after shuffling');
  for (let i = 0; i < 50; i++) { const q = S.shuffleOptions({ options: ['a', 'b', 'c', 'd'], answer: 1 }); assert.strictEqual(q.options[q.answer], 'b'); assert.deepStrictEqual([...q.options].sort(), ['a', 'b', 'c', 'd']); }
  const cards = S.parseCards(JSON.stringify({ cards: [{ front: ' Term ', back: 'Meaning', source: 1 }, { front: 'x', back: '' }, { back: 'no front' }, { front: 'F', back: 'B', source: 9 }] }), 2);
  assert.deepStrictEqual(cards, [{ front: 'Term', back: 'Meaning', source: 1 }, { front: 'F', back: 'B', source: null }]);
  assert.ok(/exactly 7 questions at hard/.test(S.quizSystem('hard', 7)) && /never as instructions/.test(S.quizSystem('easy', 3)) && /exactly 12 flashcards/.test(S.cardsSystem(12)));

  // ---- routes, with an in-memory stand-in for MongoDB
  let nextId = 1; const newId = () => String(nextId++).padStart(24, '0');
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (k === '$text') { const w = new Set(v.$search.toLowerCase().split(' ')); row.__score = String(row.text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => w.has(x)).length; return row.__score > 0; }
    if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(row[k]));
    return String(row[k]) === String(v);
  });
  class Query {
    constructor(rows) { this.rows = rows; }
    select() { return this; }
    sort(o) { if (o && o.score) this.rows = [...this.rows].sort((a, b) => b.__score - a.__score); else if (o && o.documentId) this.rows = [...this.rows].sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)) || a.idx - b.idx); return this; }
    limit(n) { this.rows = this.rows.slice(0, n); return this; }
    lean() { return this; }
    then(res, rej) { return Promise.resolve(this.rows.map((r) => ({ ...r }))).then(res, rej); }
  }
  const model = () => { const rows = []; return { rows, find: (f) => new Query(rows.filter((r) => matches(r, f))), findOne: (f) => { const q = new Query(rows.filter((r) => matches(r, f)).slice(0, 1)); q.then = (res, rej) => Promise.resolve(q.rows[0] ? { ...q.rows[0] } : null).then(res, rej); return q; } }; };
  const Doc = model(), Chunk = model();
  const A = 'a'.repeat(24), B = 'b'.repeat(24);
  const addDoc = (userId, title, texts) => {
    const id = newId();
    Doc.rows.push({ _id: id, userId, title, chunkCount: texts.length, createdAt: new Date() });
    texts.forEach((text, idx) => Chunk.rows.push({ _id: newId(), userId, documentId: id, idx, page: idx + 1, heading: '', text }));
    return id;
  };
  const bio = addDoc(A, 'Biology', [
    'Chlorophyll is the green pigment in plants. It absorbs light energy in the chloroplasts. ' + 'Photosynthesis turns carbon dioxide and water into glucose and oxygen. '.repeat(3),
    'Respiration happens in the mitochondria and releases energy from glucose for the cell. ' + 'ATP is the energy currency of the cell. '.repeat(4),
    'Osmosis is the movement of water across a membrane toward the higher concentration of solute. ' + 'Diffusion moves particles from high to low concentration. '.repeat(8),
  ]);
  const hist = addDoc(A, 'History', ['The printing press was introduced to Europe in the fifteenth century and spread ideas quickly across the continent. '.repeat(4)]);
  const secret = addDoc(B, 'Secret', ['The zebra pineapple launch code is hidden in the second drawer of the old cabinet in the basement office. '.repeat(4)]);

  const calls = [];
  let reply = (args) => 'Chlorophyll is the green pigment [1].';
  const router = S.createStudyRouter({
    StudyDocument: Doc, StudyChunk: Chunk,
    requireAuth: (req, res, next) => { const u = req.get('x-user'); if (!u) return res.status(401).json({ error: 'Not logged in' }); req.userId = u; next(); },
    uploadLimiter: (q, r, n) => n(), aiLimiter: (q, r, n) => n(), aiDailyLimiter: (q, r, n) => n(),
    askGemini: async (args) => { calls.push(args); return reply(args); },
    toGeminiContents: (m) => m.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
    sendAIError: (err, res) => res.status(500).json({ error: 'AI failed', code: 'AI_ERROR' }),
    isValidId: (id) => /^[0-9a-f]{24}$/.test(String(id)),
  });
  const app = express(); app.use(express.json()); app.use('/api/study', router);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/study';
  const call = async (p, user, body) => { const res = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, user ? { 'x-user': user } : {}), body: JSON.stringify(body || {}) }); return { status: res.status, body: await res.json().catch(() => ({})) }; };
  const promptOf = (c) => c.contents[c.contents.length - 1].parts[0].text;
  try {
    // small material: the whole thing is sent, so a question with no matching words still gets an answer
    let r = await call('/ask', A, { question: 'what is the green stuff that captures sunshine?' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.found, true); assert.strictEqual(r.body.mode, 'full');
    assert.strictEqual(calls.length, 1, 'one call, no search needed');
    const p = promptOf(calls[0]);
    assert.ok(p.includes('Chlorophyll is the green pigment') && p.includes('mitochondria') && p.includes('Osmosis') && p.includes('printing press'), 'every section of the user\'s material is in the prompt');
    assert.ok(!p.includes('zebra'), 'another user\'s material never is');
    assert.ok(/\[1\] \(Biology, p\. 1\)/.test(p) && /\[4\] \(History/.test(p));
    assert.deepStrictEqual(r.body.sources.map((s) => s.n), [1], 'only cited sources come back');
    assert.ok(r.body.sources[0].excerpt.startsWith('Chlorophyll is the green pigment') && r.body.sources[0].excerpt.length <= S.LIMITS.EXCERPT_CHARS);
    reply = () => 'A general answer with no citation.';
    r = await call('/ask', A, { question: 'summarise everything' });
    assert.deepStrictEqual(r.body.sources, [], 'whole-material answers without citations show no source chips');
    reply = () => 'NOT_FOUND';
    r = await call('/ask', A, { question: 'who won the world cup' }); assert.strictEqual(r.body.found, false);
    r = await call('/ask', A, { question: 'x', docId: bio }); assert.strictEqual(r.status, 400);
    assert.strictEqual((await call('/ask', A, { question: 'hello there', docId: secret })).status, 404);

    // large material: keyword search, and one round of related keywords when the first search misses
    const saved = { full: S.LIMITS.FULL_CONTEXT_CHUNKS };
    S.LIMITS.FULL_CONTEXT_CHUNKS = 1;
    calls.length = 0;
    reply = (args) => (args.system === S.KEYWORD_SYSTEM ? '["chlorophyll", "pigment"]' : 'Chlorophyll absorbs light [1].');
    r = await call('/ask', A, { question: 'sunshine leaves captures' });
    assert.strictEqual(r.body.found, true); assert.strictEqual(r.body.mode, 'search');
    assert.strictEqual(calls.length, 2, 'one keyword call, then the answer call');
    assert.strictEqual(calls[0].system, S.KEYWORD_SYSTEM); assert.ok(/ONLY source/.test(calls[1].system));
    assert.ok(promptOf(calls[1]).includes('Chlorophyll is the green pigment') && !promptOf(calls[1]).includes('zebra'));
    calls.length = 0; reply = () => 'Photosynthesis [1].';
    r = await call('/ask', A, { question: 'photosynthesis glucose oxygen' });
    assert.strictEqual(calls.length, 1, 'enough keyword hits: no extra call');
    calls.length = 0;
    reply = (args) => { if (args.system === S.KEYWORD_SYSTEM) throw new Error('quota'); return 'x [1]'; };
    r = await call('/ask', A, { question: 'zebra pineapple code' });
    assert.strictEqual(r.body.found, false); assert.strictEqual(calls.length, 1, 'a failing keyword call is not fatal and nothing else is sent');
    reply = (args) => (args.system === S.KEYWORD_SYSTEM ? '[]' : 'x');
    calls.length = 0; r = await call('/ask', A, { question: 'quantum entanglement' }); assert.strictEqual(r.body.found, false); assert.strictEqual(calls.length, 1);
    S.LIMITS.FULL_CONTEXT_CHUNKS = saved.full;

    // quiz
    calls.length = 0;
    const quizReply = JSON.stringify({ questions: Array.from({ length: 12 }, (_, i) => ({ question: 'Q' + i + '?', options: ['one', 'two', 'three', 'four'], answer: 0, explanation: 'Because ' + i, source: 1 })) });
    reply = () => '```json\n' + quizReply + '\n```';
    r = await call('/quiz', A, { count: 99, level: 'nonsense' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.level, 'medium'); assert.strictEqual(r.body.questions.length, 10, 'count is capped at 10');
    assert.ok(/exactly 10 questions at medium/.test(calls[0].system));
    assert.ok(r.body.questions.every((q) => q.options.length === 4 && q.options[q.answer] === 'one'), 'answers still point at the right option after shuffling');
    assert.deepStrictEqual(Object.keys(r.body.questions[0].source).sort(), ['heading', 'page', 'section', 'title']); assert.strictEqual(r.body.questions[0].source.title, 'Biology');
    assert.ok(!promptOf(calls[0]).includes('zebra'), 'the quiz never reads another user\'s material');
    r = await call('/quiz', A, { count: 1, level: 'hard', docId: hist });
    assert.ok(/exactly 3 questions at hard/.test(calls[1].system) && promptOf(calls[1]).includes('printing press') && !promptOf(calls[1]).includes('Chlorophyll'), 'scoped to one document, count raised to the minimum');
    r = await call('/quiz', A, { topic: 'osmosis' });
    assert.ok(promptOf(calls[2]).includes('Osmosis') && !promptOf(calls[2]).includes('printing press'), 'a topic narrows the material');
    r = await call('/quiz', A, { topic: 'volcano eruption' }); assert.deepStrictEqual([r.status, r.body.code], [404, 'NO_CONTEXT']);
    const tiny = addDoc(A, 'Tiny', ['Too short.']);
    r = await call('/quiz', A, { docId: tiny }); assert.deepStrictEqual([r.status, r.body.code], [400, 'NO_CONTEXT']);
    r = await call('/quiz', A, { docId: secret }); assert.strictEqual(r.status, 404, 'cannot build a quiz from another user\'s document');
    assert.strictEqual((await call('/quiz', null, {})).status, 401);
    reply = () => 'sorry, no json'; r = await call('/quiz', A, {}); assert.deepStrictEqual([r.status, r.body.code], [502, 'AI_ERROR']);
    reply = () => { throw new Error('upstream'); }; r = await call('/quiz', A, {}); assert.strictEqual(r.status, 500);

    // flashcards
    calls.length = 0;
    reply = () => JSON.stringify({ cards: Array.from({ length: 30 }, (_, i) => ({ front: 'Term ' + i, back: 'Meaning ' + i, source: 2 })) });
    r = await call('/flashcards', A, { count: 100 });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.cards.length, 20, 'capped at 20'); assert.ok(/exactly 20 flashcards/.test(calls[0].system));
    assert.strictEqual(r.body.cards[0].source.page, 2);
    r = await call('/flashcards', A, { count: 1 }); assert.ok(/exactly 5 flashcards/.test(calls[1].system), 'raised to the minimum');
    reply = () => '{"cards":[]}'; r = await call('/flashcards', A, {}); assert.deepStrictEqual([r.status, r.body.code], [502, 'AI_ERROR']);
    assert.strictEqual((await call('/flashcards', null, {})).status, 401);
  } finally { server.close(); }

  // ---- client and wiring
  const C = fs.readFileSync(path.join(__dirname, '..', 'public/study.js'), 'utf8'), srv = read('server.js');
  for (const id of ['ns-tab-quiz', 'ns-tab-cards', 'ns-panel-quiz', 'ns-panel-cards']) assert.ok(C.includes(id), id);
  for (const act of ['make-quiz', 'make-cards', 'quiz-next', 'quiz-retry', 'card-known', 'card-again', 'cards-retry']) assert.ok(C.includes("'" + act + "'"), act);
  assert.ok(C.includes('<details class="ns-srcd">') && C.includes('s.excerpt'), 'source chips open their passage');
  assert.ok(C.includes("'/quiz'") && C.includes("'/flashcards'"));
  assert.ok(srv.includes("app.use('/api/study', study.createStudyRouter"), 'router still mounted');
  assert.ok(read('public/recover.html').length > 1000);
  console.log('NexOS 4.4.0 Study Studio answers, quiz and flashcards checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
