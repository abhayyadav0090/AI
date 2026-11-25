const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const D = require('../public/derail.js');

// open tasks that matter today
const tasks = [
  { id: 'a', title: 'Finish report', priority: 'high', stage: 'todo', due: '2026-11-24' },
  { id: 'b', title: 'Tidy desk', priority: 'low', stage: 'todo', due: '' },
  { id: 'c', title: 'Already done', priority: 'low', stage: 'done', due: '2026-11-24' },
  { id: 'd', title: 'Next week thing', priority: 'medium', stage: 'todo', due: '2026-12-01' },
  { id: 'e', title: 'Overdue', priority: 'medium', stage: 'inprogress', due: '2026-11-20' },
  { id: 'f', title: '   ', priority: 'low', stage: 'todo', due: '' }
];
const list = D.candidates(tasks, '2026-11-24');
assert.deepStrictEqual(list.map((t) => t.id), ['a', 'b', 'e'], 'done, future and untitled tasks are left out');
assert.strictEqual(D.isoPlus('2026-11-30', 1), '2026-12-01');
assert.strictEqual(D.isoPlus('2026-12-31', 1), '2027-01-01');

// prompt: drop, do not squeeze, only given ids, tomorrow's date
const prompt = D.buildPrompt(list, 120, '2026-11-24');
assert.ok(prompt.includes('2 hours') && prompt.includes('2026-11-25') && /Do NOT squeeze/.test(prompt) && prompt.includes('"id":"a"'));
assert.ok(D.buildPrompt(list, 0, '2026-11-24').includes('the rest of today'));

// parsing: unknown ids dropped, duplicates dropped, fences stripped, capped at 8, never trusts titles from the model
const out = D.parse('```json\n{"summary":"Keep the report.","move":[{"id":"b","reason":"low"},{"id":"zzz"},{"id":"b"},{"id":"e","reason":"flexible"}]}\n```', list);
assert.deepStrictEqual(out.moves.map((m) => m.id), ['b', 'e']);
assert.strictEqual(out.moves[0].title, 'Tidy desk');
assert.strictEqual(out.summary, 'Keep the report.');
assert.deepStrictEqual(D.parse('{"summary":"ok","move":[]}', list).moves, []);
assert.throws(() => D.parse('no json here', list));
assert.throws(() => D.parse('{bad json}', list));
const many = Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, title: 'T' + i, priority: 'low', stage: 'todo', due: '' }));
assert.strictEqual(D.parse(JSON.stringify({ move: many.map((t) => ({ id: t.id })) }), many).moves.length, 8);

// guest samples: scripted, tomorrow's date, no AI
const dd = D.demo('derail', '2026-11-24'), dp = D.demo('plan', '2026-11-24');
assert.ok(dd.items.length >= 2 && dd.items.every((i) => i.title.startsWith('Move to tomorrow') && i.detail.includes('2026-11-25')));
assert.ok(dp.items.length >= 3 && dp.items.some((i) => i.title.startsWith('Create note')));

// wiring
const classic = read('public/app.js'), ent = read('public/index-redesign.html'), ch = read('public/index.html'), sw = read('public/sw.js'), mod = read('public/derail.js');
assert.ok(ch.includes('derail.js?v=4.5.0') && ent.includes('derail.js?v=4.5.0') && sw.includes("'/derail.js?v=4.5.0'"), 'derail.js loaded in both pages and precached');
assert.ok(ch.includes('id="nexos-derail-btn"') && classic.includes('openDayDerailed') && classic.includes('NexDerail.open(derailAdapter())'), 'Classic button');
assert.ok(ent.includes('onclick="openDayDerailed()"') && ent.includes('NexDerail.open(derailAdapter())'), 'Enterprise buttons');
assert.ok(classic.includes("NexDerail.openDemo('plan', derailAdapter())") && ent.includes("NexDerail.openDemo('plan', derailAdapter())"), 'guest Action Mode shows the sample');
assert.ok(classic.indexOf("if (isGuest()) { // 4.0.0") < classic.indexOf("const requestEl = document.getElementById('nexos-action-request')"), 'Classic guest check comes before the empty-request check');
assert.ok(ent.indexOf("// 4.0.0: guests and preview") < ent.indexOf("const request = document.getElementById('action-mode-input-text')"), 'Enterprise guest check comes before the empty-request check');
// only the task date changes, nothing is deleted or created by Day derailed
assert.ok(/task\.due = to;/.test(classic) && /task\.due = to;/.test(ent) && !/splice|delete state\.tasks/.test(mod), 'only due dates change');
// guests never reach the AI from the module
assert.ok(mod.indexOf('adapter.isGuest()') < mod.indexOf('adapter.askAI('), 'guest check precedes any AI call');
// dialog sits above the Enterprise Action Mode modal (z-index 2000)
assert.ok(/z-index:2100/.test(mod));
// the guest demo changes nothing: demo approve never calls applyMoves
assert.ok(/current\.demo[\s\S]*?return;[\s\S]*?adapter\.applyMoves/.test(mod), 'demo returns before applyMoves');
// unchanged areas
assert.ok(read('public/recover.html').length > 1000, 'Recovery Center untouched');
console.log('NexOS 4.0.0 Day derailed and guest sample checks passed.');
