'use strict';
// Checks the 2.5.7 first-day rules: milestones, score, guest insight, plan sizing, and that Enterprise shows no invented numbers.
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const app = read('app.js'), ent = read('index-redesign.html');
const A = '// ---- Day-1 helpers', B = '// ---- end Day-1 helpers ----';
const block = s => { const i = s.indexOf(A), j = s.indexOf(B, i); if (i < 0 || j < 0) throw new Error('Day-1 helpers not found'); return s.slice(i, j + B.length); };
assert.strictEqual(block(app), block(ent), 'Classic and Enterprise must share identical Day-1 helpers');

const ctx = {};
vm.createContext(ctx);
new vm.Script(block(app) + '\nthis.m = nexDay1Milestones; this.score = nexProductivityScore; this.insight = nexLocalInsight;').runInContext(ctx);
const T = '2026-11-05';

// Milestones: works for Classic (col) and Enterprise (stage) task shapes
let r = ctx.m({ tasks: [{ col: 'todo' }], habits: [{ checks: {} }], pomodoroLog: [] });
assert.strictEqual(r.done, 0); assert.strictEqual(r.total, 3);
r = ctx.m({ tasks: [{ col: 'inprogress' }], habits: [{ checks: {} }], pomodoroLog: [] });
assert.strictEqual(r.done, 0, 'a seeded in-progress starter task is not a completed milestone');
r = ctx.m({ tasks: [{ stage: 'done' }], habits: [{ checks: { '2026-11-01': true } }], pomodoroLog: [{ date: T, minutes: 25 }] });
assert.strictEqual(r.done, 3);
assert.strictEqual(ctx.m(null).done, 0, 'missing state does not throw');
assert.strictEqual(ctx.m({ pomodoroLog: [{ date: T, minutes: 0 }] }).done, 0, 'a zero-minute log is not a session');

// Score: same formula as before (tasks 40, focus 30 capped at 120 min, habits 30)
assert.strictEqual(ctx.score({ tasks: [], habits: [], pomodoroLog: [] }, T), 0);
assert.strictEqual(ctx.score({ tasks: [{ col: 'done' }, { col: 'todo' }], habits: [{ checks: { [T]: true } }, { checks: {} }], pomodoroLog: [{ date: T, minutes: 60 }] }, T), 20 + 15 + 15);
assert.strictEqual(ctx.score({ tasks: [{ stage: 'done' }], habits: [{ checks: { [T]: true } }], pomodoroLog: [{ date: T, minutes: 500 }] }, T), 100);
assert.strictEqual(ctx.score({ tasks: [], habits: [], pomodoroLog: [{ date: '2026-11-04', minutes: 120 }] }, T), 0, 'only today counts');

// Guest insight: simple, local, always a string
const ins = (st, fm) => ctx.insight(st, T, fm);
assert.ok(/Add one task or habit/.test(ins({ tasks: [], habits: [] })));
assert.ok(/overdue/.test(ins({ tasks: [{ title: 'Old', col: 'todo', priority: 'low', due: '2026-11-01' }], habits: [] })));
assert.ok(/Start with .Write report.\. One 50-minute focus block/.test(ins({ tasks: [{ title: 'Write report', col: 'todo', priority: 'high' }, { title: 'x', col: 'todo', priority: 'low' }], habits: [], pomodoroLog: [] }, 50)), 'top priority task and the timer length');
assert.ok(/1 of 2 habits are still open/.test(ins({ tasks: [], habits: [{ checks: { [T]: true } }, { checks: {} }], pomodoroLog: [] })));
assert.ok(/Everything is done/.test(ins({ tasks: [{ col: 'done', title: 'a' }], habits: [{ checks: { [T]: true } }], pomodoroLog: [] })));
assert.ok(ins({ tasks: [{ title: 'z'.repeat(500), col: 'todo' }], habits: [] }, 25).length < 200, 'long titles are trimmed');

// Classic plan: blocks follow the focus timer, breaks follow the short-break setting
{
  const i = app.indexOf('function buildQuickLocalPlan('), j = app.indexOf('function renderPlanItems(', i);
  const c = { state: { tasks: [{ id: 'a', col: 'todo', priority: 'low' }, { id: 'b', col: 'todo', priority: 'high' }, { id: 'c', col: 'todo', priority: 'medium', estimateMinutes: 20 }], habits: [{ id: 'h', estimateMinutes: 10 }], dailyPlan: null },
    pomDurations: { focus: 50, short: 10, long: 20 }, clockMinutes: () => 9 * 60, today: () => T, saveState() {}, renderPlanItems() {}, timeLabel: m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), document: { getElementById: () => null }, Math, Number, Date };
  vm.createContext(c);
  new vm.Script(app.slice(i, j)).runInContext(c);
  c.buildQuickLocalPlan(true);
  const items = JSON.parse(JSON.stringify(c.state.dailyPlan.items));
  assert.deepStrictEqual(items.map(x => x.id), ['b', 'c', 'a', 'h'], 'priority order, habits last');
  assert.deepStrictEqual(items.map(x => x.duration), [50, 20, 50, 10], 'tasks without an estimate use the focus length');
  assert.deepStrictEqual(items.map(x => x.start), ['09:00', '10:00', '10:30', '11:30'], 'each block is followed by the short break');
  assert.ok(items.every(x => !x.unscheduled));
}

// Wiring checks
assert.ok(/if \(isGuest\(\)\) \{[^}]*nexLocalInsight\(state, today\(\), pomDurations\.focus\)/.test(app), 'guest insight is local');
assert.ok(/Sign in with Google for NexAI scheduling/.test(app), 'guest plan footer');
assert.ok(app.includes('id="score-milestones"') === false && read('index.html').includes('id="score-milestones"'), 'Classic score card has the milestone list');
assert.ok(/renderDay1Milestones\(\);\s*\n\}/.test(app), 'Classic renders milestones with the score');
assert.ok(ent.includes('analytics-score-milestones') && ent.includes('renderEnterpriseScore();'), 'Enterprise score card has milestones and renders them');
assert.ok(!/id="analytics-score-num">88</.test(ent), 'Enterprise no longer shows a fixed 88');
assert.ok(!ent.includes('[50, 75, 45, 90, 60, 25'), 'Enterprise focus chart no longer uses invented minutes');
assert.ok(!ent.includes('[4, 7, 5, 11'), 'Enterprise velocity chart no longer uses invented weeks');
assert.ok(!ent.includes('todo || 1, prog || 1'), 'Enterprise donut no longer invents segments');
console.log('Day-1 rules passed.');
