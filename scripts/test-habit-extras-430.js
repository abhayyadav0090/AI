const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../public/habits.js');
const R = require('../lib/habit-reminders.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T = '2026-11-24'; // a Tuesday
const mk = (id, keys, extra) => ({ id, name: 'H' + id, checks: Object.fromEntries((keys || []).map((k) => [k, true])), ...(extra || {}) });

// ---- reorder skips paused habits
let list = [mk('a'), mk('b', [], { archived: true }), mk('c'), mk('d')];
assert.ok(H.move(list, 'c', -1)); assert.deepStrictEqual(list.map((h) => h.id), ['c', 'b', 'a', 'd'], 'moves past the paused habit');
assert.ok(H.move(list, 'a', 1)); assert.deepStrictEqual(list.map((h) => h.id), ['c', 'b', 'd', 'a']);
assert.strictEqual(H.move(list, 'c', -1), false); assert.strictEqual(H.move(list, 'a', 1), false); assert.strictEqual(H.move(list, 'zzz', 1), false); assert.strictEqual(H.move(list, 'c', 2), false);

// ---- per-habit heatmap: 12 weeks, today's week last, future days empty, colour cannot inject CSS
const hm = H.heatmapHtml(mk('x', ['2026-11-24', '2026-11-23', '2026-09-07', '2026-09-06']), T, '#34A853');
assert.strictEqual((hm.match(/<i/g) || []).length, 84);
assert.strictEqual((hm.match(/hm-on/g) || []).length, 3, 'only checks inside the 12-week window are drawn (2026-09-06 is outside)');
assert.strictEqual((hm.match(/hm-future/g) || []).length, 5, 'Wed to Sun of this week are in the future');
assert.ok(hm.includes('title="2026-11-24"'));
assert.ok(!H.heatmapHtml(mk('x', ['2026-11-24']), T, 'red;background:url(//evil)').includes('evil'), 'unsafe colours are replaced');
assert.ok(H.heatmapHtml(mk('x', ['2026-11-24']), T, 'var(--accent-primary)').includes('var(--accent-primary)'));
assert.strictEqual(H.heatmapHtml({}, 'bad', '#fff'), '');

// ---- insights and details
const ins = H.insights(mk('x', ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', '2026-11-12']), T); // four Tuesdays and a Thursday
assert.deepStrictEqual([ins.bestWeekday, ins.lastDoneDaysAgo, ins.firstKey], ['Tuesday', 0, '2026-11-03']);
assert.strictEqual(H.insights(mk('x', ['2026-11-23']), T).bestWeekday, '', 'needs a few check-ins before naming a weekday');
assert.strictEqual(H.insights({}, T).lastDoneDaysAgo, null);
const detail = H.detailHtml(mk('x', ['2026-11-23'], { remindAt: '20:30' }), T, '#4285F4');
assert.ok(detail.includes('Last done: yesterday') && detail.includes('Reminder 20:30') && detail.includes('habit-hm'));
assert.ok(H.detailHtml(mk('x', [], { name: '<b>' }), T, '#fff').includes('Last done: not yet'));
const extras = H.editExtrasHtml(mk('q', [], { remindAt: '07:15' }), { input: 'i', btn: 'b' });
assert.ok(extras.includes('value="07:15"') && extras.includes("moveHabit('q',-1)") && extras.includes("moveHabit('q',1)") && extras.includes("archiveHabit('q')") && extras.includes('id="habit-edit-remind"'));
assert.ok(H.editExtrasHtml(mk('q', [], { remindAt: 'junk' }), { input: 'i', btn: 'b' }).includes('value=""'));
assert.strictEqual(H.isActive({ archived: true }), false); assert.strictEqual(H.isActive({}), true);

// ---- reminders: who is due now
const due = (habits, now, win) => R.dueHabitReminders(habits, T, now, win);
assert.deepStrictEqual(due([mk('a', [], { remindAt: '20:00' })], '20:00').map((x) => x.id), ['a'], 'due at the chosen time');
assert.deepStrictEqual(due([mk('a', [], { remindAt: '20:00' })], '19:59'), [], 'not before');
assert.deepStrictEqual(due([mk('a', [], { remindAt: '20:00' })], '23:01'), [], 'not more than three hours late');
assert.strictEqual(due([mk('a', [], { remindAt: '20:00' })], '23:00').length, 1);
assert.deepStrictEqual(due([mk('a', [T], { remindAt: '08:00' })], '09:00'), [], 'already done today');
assert.deepStrictEqual(due([mk('a', [], { remindAt: '08:00', archived: true })], '09:00'), [], 'paused');
assert.deepStrictEqual(due([mk('a', [], { remindAt: '8am' }), mk('b')], '09:00'), [], 'bad or missing time');
assert.deepStrictEqual(due([mk('a', ['2026-11-23'], { remindAt: '08:00', goal: 1 })], '09:00'), [], 'weekly goal already met this week');
assert.strictEqual(due([mk('a', ['2026-11-23'], { remindAt: '08:00', goal: 2 })], '09:00').length, 1, 'weekly goal not met yet');
assert.deepStrictEqual(R.dueHabitReminders('nope', T, '09:00'), []); assert.deepStrictEqual(R.dueHabitReminders([mk('a', [], { remindAt: '08:00' })], T, 'late'), []);
assert.strictEqual(due(Array.from({ length: 9 }, (_, i) => mk('h' + i, [], { remindAt: '08:00' })), '09:00').length, 5, 'at most five at a time');
const pay = R.habitReminderPayload({ id: 'a', name: 'Read', current: 5, mode: 'day' });
assert.deepStrictEqual([pay.kind, pay.habitId, pay.body, pay.title], ['habit', 'a', 'Keep your 5-day streak going: Read', 'NexOS habit reminder']);
assert.strictEqual(R.habitReminderPayload({ id: 'a', name: 'Read', current: 0, mode: 'day' }).body, 'Time for: Read');
assert.ok(R.habitReminderPayload({ id: 'a', name: 'Read', current: 3, mode: 'week' }).body.includes('3-week'));
assert.strictEqual(R.habitReminderKey(T, 'a'), '2026-11-24:habit:a');
assert.ok(R.habitReminderKey(T, 'a').slice(0, 10) === T, 'sent-key retention works by date prefix');

// ---- page behaviour: pause, resume, move (run the real functions against a stub page)
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
for (const enterprise of [false, true]) {
  const src = enterprise ? read('public/index-redesign.html') : read('public/app.js');
  const toasts = [];
  const state = { habits: [mk('a'), mk('b'), mk('c')], dailyPlan: { items: [{ type: 'habit', id: 'b' }, { type: 'task', id: 'b' }] } };
  const ctx = { state, window: { NexHabits: H }, NexHabits: H, document: { getElementById: () => null }, editingHabitId: 'b', habitDetailId: 'b',
    saveState() {}, saveWorkspaceState() {}, renderHabits() {}, renderDashboard() {}, updateStats() {}, updateContextPanel() {}, renderAnalytics() {},
    notify: (m, o) => toasts.push([m, o]), showToast: (m, o) => toasts.push([m, o]), habitHexColor: () => '#4285F4' };
  vm.createContext(ctx);
  vm.runInContext('var editingHabitId = \'b\'; var habitDetailId = \'b\';\n' + ['habitHexColor', 'applyHabitFields', 'refreshHabitViews', 'moveHabit', 'archiveHabit', 'resumeHabit'].map((n) => n === 'habitHexColor' && !enterprise ? '' : fn(src, n)).join('\n'), ctx);
  ctx.archiveHabit('b');
  assert.strictEqual(state.habits[1].archived, true, 'paused');
  assert.strictEqual(state.habits.length, 3, 'history is kept');
  assert.strictEqual(vm.runInContext('editingHabitId', ctx), null); assert.strictEqual(vm.runInContext('habitDetailId', ctx), null);
  if (!enterprise) assert.deepStrictEqual(state.dailyPlan.items, [{ type: 'task', id: 'b' }], 'plan entry for the paused habit is removed');
  const undo = toasts[toasts.length - 1][1];
  assert.strictEqual(undo.action, 'Undo'); undo.onAction();
  assert.strictEqual(state.habits[1].archived, undefined, 'undo resumes');
  ctx.archiveHabit('b'); ctx.resumeHabit('b');
  assert.strictEqual(state.habits[1].archived, undefined);
  ctx.moveHabit('c', -1);
  assert.deepStrictEqual(state.habits.map((h) => h.id), ['a', 'c', 'b']);
  ctx.archiveHabit('c'); ctx.moveHabit('a', 1); // c is paused, so a swaps with b
  assert.deepStrictEqual(state.habits.map((h) => h.id), ['b', 'c', 'a']);
}

// ---- wiring in both pages and on the server
const classic = read('public/app.js'), ent = read('public/index-redesign.html'), srv = read('server.js');
for (const [name, src] of [['Classic', classic], ['Enterprise', ent]]) {
  assert.ok(src.includes('function activeHabits()') && src.includes('function pausedHabitsHtml(') && src.includes('toggleHabitDetail(') && src.includes('NexHabits.detailHtml(') && src.includes('NexHabits.editExtrasHtml('), name + ' wiring');
  assert.ok(!/state\.habits\.slice\(0, (4|8|12)\)/.test(src), name + ' lists draw only active habits');
}
assert.ok(srv.includes("select('userId data.tasks data.habits')") && srv.includes('dueHabitReminders(item.data && item.data.habits, todayKey, nowTime)') && srv.includes('habitReminderPayload(entry)'));
assert.ok(srv.indexOf('const habitsDue') < srv.indexOf('PushSubscription.find({ userId: item.userId'), 'habit reminders are worked out before subscriptions are loaded');
assert.ok(read('public/recover.html').length > 1000);
console.log('NexOS 4.3.0 habit pause, order, details and reminder checks passed.');
