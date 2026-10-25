'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index-redesign.html'), 'utf8');
const start = html.indexOf('function safeEnterpriseStage(value)');
const end = html.indexOf('function enterpriseLocalKey()', start);
if (start < 0 || end < 0) throw new Error('Enterprise data-mapping adapter not found.');
const adapters = html.slice(start, end);
const context = {
  state: { tasks: [], habits: [], notes: [], pomodoroLog: [], pomodoroStats: {}, currentNoteId: null },
  uid: (() => { let id = 0; return () => `test-${++id}`; })(),
  console,
};
vm.createContext(context);
new vm.Script(adapters, { filename: 'enterprise-data-adapters.js' }).runInContext(context);
const classic = {
  tasks: [{ id: 'shared-task', title: 'Keep this task', desc: 'classic fields', col: 'inprogress', priority: 'high', due: '2026-10-25', created: 123, tags: ['shared'], subtasks: [{ id: 'st1', text: 'Subtask', completed: true }] }],
  habits: [{ id: 'shared-habit', name: 'Read', color: '#3A0F34', streak: 4, checks: { '2026-10-23': true } }],
  notes: [{ id: 'shared-note', title: 'Keep note', content: 'Content', tags: ['tag'], pinned: true, created: 456 }],
  pomodoroLog: [{ date: '2026-10-23', minutes: 25 }],
  pomodoroStats: { totalToday: 25, sessionsToday: 1, longestStreak: 1, lastDate: '2026-10-23' },
  currentNoteId: 'shared-note', theme: 'dark', seeded: true, dailyPlan: { date: '2026-10-23', items: [] },
  enterpriseWorkspace: { theme: 'fluent-light', density: 'compact', pomodoroStats: { totalMins: 175, sessions: 7, streak: 4 } }
};
let enterprise = context.classicRootToEnterprise(classic, {});
if (enterprise.tasks[0].stage !== 'inprogress' || enterprise.tasks[0].priority !== 'high') throw new Error('Classic task did not map to Enterprise status/priority.');
if (enterprise.habits[0].checks['2026-10-23'] !== true || enterprise.notes[0].content !== 'Content') throw new Error('Habits/notes did not load from the shared backend state.');
if (enterprise.pomodoroStats.totalMins !== 175 || enterprise.theme !== 'fluent-light') throw new Error('Enterprise UI preferences/focus stats were not loaded.');
enterprise.tasks[0].stage = 'review';
enterprise.tasks[0].desc = 'updated from enterprise';
enterprise.tasks.push({ id: 'new-enterprise-task', title: 'Created in Enterprise', stage: 'todo', priority: 'medium', due: '2026-10-26', created: 789, tags: [], subtasks: [] });
enterprise.notes[0].content = 'Edited in Enterprise';
context.state = enterprise;
const merged = context.enterpriseToClassicRoot(classic);
if (merged.tasks[0].col !== 'review' || merged.tasks[0].desc !== 'updated from enterprise') throw new Error('Enterprise edits did not map back to Classic canonical task fields.');
if ('stage' in merged.tasks[0] || 'dueDate' in merged.tasks[0]) throw new Error('Enterprise-only fields leaked into Classic canonical tasks.');
if (!merged.tasks.some(t => t.id === 'new-enterprise-task')) throw new Error('New Enterprise task missing from shared root state.');
if (merged.notes[0].content !== 'Edited in Enterprise') throw new Error('Enterprise note edits did not map back to shared state.');
if (merged.theme !== 'dark') throw new Error('Enterprise theme unexpectedly overwrote Classic theme.');
if (merged.dailyPlan.date !== classic.dailyPlan.date) throw new Error('Classic-only workspace fields were not preserved.');
if (merged.enterpriseWorkspace.theme !== 'fluent-light' || merged.enterpriseWorkspace.density !== 'compact') throw new Error('Enterprise-specific display preferences were not saved.');
console.log('Enterprise-to-Classic workspace mapping checks passed.');

// ---- 2.4.0: merging, so a save never wipes changes made elsewhere ----
const assert = require('node:assert');
const T = (id, extra = {}) => ({ id, title: id, col: 'todo', ...extra });
const J = v => JSON.parse(JSON.stringify(v)); // values from the sandboxed script have another Array prototype
// 1. A task added on another device survives
let out = context.mergeById([T('a'), T('remote-new')], [T('a')], [T('a')]);
assert.deepStrictEqual(J(out.map(t => t.id)), ['a', 'remote-new'], 'task added elsewhere was dropped');
// 2. A task I added is kept
out = context.mergeById([T('a')], [T('a'), T('mine')], [T('a')]);
assert.deepStrictEqual(J(out.map(t => t.id)).sort(), ['a', 'mine'], 'task added here was dropped');
// 3. A task I deleted stays deleted; one deleted elsewhere stays deleted
out = context.mergeById([T('a'), T('b')], [T('a')], [T('a'), T('b')]);
assert.deepStrictEqual(J(out.map(t => t.id)), ['a'], 'task deleted here came back');
out = context.mergeById([T('a')], [T('a'), T('b')], [T('a'), T('b')]);
assert.deepStrictEqual(J(out.map(t => t.id)), ['a'], 'task deleted elsewhere came back');
// 4. Untouched here + edited elsewhere: take the other edit
out = context.mergeById([T('a', { title: 'edited on phone' })], [T('a')], [T('a')]);
assert.strictEqual(out[0].title, 'edited on phone', 'edit from another device was overwritten');
// 5. Edited here + edited elsewhere: my fields win, their other fields survive
out = context.mergeById([T('a', { title: 'phone', desc: 'phone desc' })], [T('a', { title: 'laptop' })], [T('a')]);
assert.strictEqual(out[0].title, 'laptop'); assert.strictEqual(out[0].desc, 'phone desc');
// 6. Edited here but deleted elsewhere: keep my edit
out = context.mergeById([], [T('a', { title: 'kept edit' })], [T('a')]);
assert.strictEqual(out.length, 1, 'edit made here was lost to a delete elsewhere');
// 7. Focus log: sessions from both sides are kept, nothing doubles
out = context.mergeLogs([{ date: '2026-10-24', minutes: 25 }, { date: '2026-10-24', minutes: 50 }], [{ date: '2026-10-24', minutes: 25 }, { date: '2026-10-24', minutes: 15 }], [{ date: '2026-10-24', minutes: 25 }]);
assert.strictEqual(out.length, 3, 'focus log merge doubled or dropped entries');
assert.ok(out.some(l => l.minutes === 15) && out.some(l => l.minutes === 50));
// 8. Dates follow the local calendar, not UTC
const lateEvening = new Date(2026, 9, 24, 0, 30); // 00:30 local on 24 Oct
assert.strictEqual(context.localDateKey(lateEvening), '2026-10-24', 'local date key is not the local calendar day');
console.log('Enterprise bridge + merge tests passed.');
