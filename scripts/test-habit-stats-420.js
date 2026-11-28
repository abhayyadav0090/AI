const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('../public/habits.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T = '2026-11-24'; // a Tuesday
const mk = (keys, extra) => ({ checks: Object.fromEntries(keys.map((k) => [k, true])), ...(extra || {}) });
const range = (from, to) => { const out = []; for (let d = H.dayNum(from); d <= H.dayNum(to); d++) out.push(new Date(d * 86400000).toISOString().slice(0, 10)); return out; };

// daily streaks: current and best are different things
let s = H.stats(mk([...range('2026-11-10', '2026-11-14'), ...range('2026-11-22', '2026-11-24')]), T);
assert.deepStrictEqual([s.mode, s.current, s.best, s.total, s.doneToday], ['day', 3, 5, 8, true]);
// today not ticked yet: the streak is still alive from yesterday
s = H.stats(mk(['2026-11-22', '2026-11-23']), T);
assert.deepStrictEqual([s.current, s.best, s.doneToday], [2, 2, false]);
// a missed yesterday breaks the current streak but keeps the best
s = H.stats(mk(['2026-11-19', '2026-11-20', '2026-11-21']), T);
assert.deepStrictEqual([s.current, s.best], [0, 3]);
// nothing, junk keys and future dates
s = H.stats({ checks: { 'nope': true, '2026-13-99': true, '2026-12-01': true, '2026-11-20': false } }, T);
assert.deepStrictEqual([s.current, s.best, s.total, s.rate30, s.milestone], [0, 0, 0, 0, 0]);
assert.deepStrictEqual(H.stats({}, T).total, 0);

// goal is clamped to 1..7 and falls back to every day
assert.deepStrictEqual([0, 9, 'x', undefined, 3.4, 5].map((g) => H.goalOf({ goal: g })), [7, 7, 7, 7, 3, 5]);

// weekly goal: weeks in a row that reached the goal (Monday to Sunday); the running week is not held against you
s = H.stats(mk(['2026-11-23', '2026-11-24', '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-09', '2026-11-11', '2026-11-13'], { goal: 3 }), T);
assert.deepStrictEqual([s.mode, s.current, s.best, s.weekDone, s.goal], ['week', 2, 2, 2, 3]);
s = H.stats(mk(['2026-11-23', '2026-11-24', '2026-11-25'].slice(0, 2).concat(['2026-11-17', '2026-11-18', '2026-11-19']), { goal: 3 }), T);
assert.strictEqual(s.current, 1);
s = H.stats(mk(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-16', '2026-11-17', '2026-11-18'], { goal: 3 }), T); // week of 9 Nov missed
assert.deepStrictEqual([s.current, s.best], [1, 1]);
// reaching the goal this week counts it
assert.strictEqual(H.stats(mk(['2026-11-23', '2026-11-24'], { goal: 2 }), T).current, 1);

// completion rate over a window that fits a young habit
assert.strictEqual(H.stats(mk(range('2026-11-11', '2026-11-24')), T).rate30, 100);
assert.strictEqual(H.stats(mk(['2026-11-18', '2026-11-20', '2026-11-22', '2026-11-24']), T).rate30, Math.round((4 / 7) * 100));
assert.ok(H.stats(mk(range('2026-10-01', '2026-11-24')), T).rate30 <= 100);

// milestones
assert.strictEqual(H.stats(mk(range('2026-11-18', '2026-11-24')), T).milestone, 7);
assert.strictEqual(H.stats(mk(range('2026-10-26', '2026-11-24')), T).milestone, 30);

// labels and summary
const L = H.labels(H.stats(mk(range('2026-11-18', '2026-11-24')), T));
assert.ok(L.streak.includes('7 day streak') && L.streak.includes('personal best') && L.milestone === '\uD83C\uDFC5 7-day club' && L.meta.includes('total'));
const L2 = H.labels(H.stats(mk([], { goal: 4 }), T));
assert.ok(L2.streak.startsWith('No streak yet') && L2.meta.includes('0/4 this week'));
const sum = H.summary([mk(range('2026-11-18', '2026-11-24')), mk(['2026-11-10']), { checks: {} }], T);
assert.deepStrictEqual([sum.active, sum.doneToday, sum.bestCurrent, sum.total], [3, 1, 7, 8]);
assert.deepStrictEqual(H.summary([], T), { active: 0, doneToday: 0, bestCurrent: 0, rate30: 0, total: 0 });
assert.ok(H.summaryHtml(sum).includes('1/3') && H.summaryHtml(sum).includes('Total check-ins'));
assert.strictEqual(H.GOAL_OPTIONS.length, 7); assert.strictEqual(H.GOAL_OPTIONS[0].label, 'Every day');

// wiring in both pages, precache, goal saved from the edit bar, stored streak untouched
const classic = read('public/app.js'), ent = read('public/index-redesign.html'), ch = read('public/index.html'), sw = read('public/sw.js');
assert.ok(ch.includes('habits.js?v=4.8.0') && ent.includes('habits.js?v=4.8.0') && sw.includes("'/habits.js?v=4.8.0'"));
assert.ok(classic.includes('habitStatsHtml(h, streak)') && classic.includes('NexHabits.renderSummary(live, today(), header)'));
assert.ok(ent.includes('habitStatsHtml(h)') && ent.includes('NexHabits.renderSummary(live, localDateKey(), container)'));
assert.ok(classic.includes('habit.goal = goal') && ent.includes('habit.goal = goal') && classic.includes('id="habit-edit-goal"') && ent.includes('id="habit-edit-goal"'));
assert.ok(ch.indexOf('habits.js?v=') < ch.indexOf('app.js?v='), 'habits.js loads before app.js');
assert.ok(!/habits\.js[\s\S]{0,40}streak\s*=/.test(read('public/habits.js')), 'module never writes the stored streak');
assert.ok(read('public/recover.html').length > 1000);
console.log('NexOS 4.2.0 habit statistics checks passed.');
