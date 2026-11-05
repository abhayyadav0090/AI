'use strict';
// Checks the Classic quick-start data rules: goals, profile sanitizing, and the starter items for each goal.
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const a = src.indexOf('const GOALS = {'), b = src.indexOf('function normalizeState(');
const c = src.indexOf('function seedStarter(goal) {'), d = src.indexOf('// ---- Quick-start screen');
if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Quick-start code not found in app.js.');
let n = 0;
const ctx = { uid: () => 'id' + (++n), state: {}, Date, Object, Number, Array };
vm.createContext(ctx);
new vm.Script(src.slice(a, b) + '\n' + src.slice(c, d) + '\nthis.GOALS = GOALS; this.sanitizeProfile = sanitizeProfile; this.seedStarter = seedStarter;').runInContext(ctx);
const J = v => JSON.parse(JSON.stringify(v));

assert.deepStrictEqual(Object.keys(ctx.GOALS), ['study', 'projects', 'habits', 'explore']);
assert.strictEqual(ctx.GOALS.study.timer.focus, 50);
assert.strictEqual(ctx.GOALS.study.timer.short, 10);
for (const [key, g] of Object.entries(ctx.GOALS)) {
  assert.strictEqual(g.home.length, 4, key + ' must place all four Home sections');
  assert.deepStrictEqual([...g.home].sort(), ['habits', 'notes', 'pomodoro', 'tasks'], key + ' home order');
  assert.ok(g.timer.focus >= 1 && g.timer.focus <= 60 && g.timer.short <= 30 && g.timer.long <= 60, key + ' timer must fit the timer inputs');
}
assert.strictEqual(ctx.sanitizeProfile(null), null);
assert.strictEqual(ctx.sanitizeProfile([]), null);
assert.strictEqual(J(ctx.sanitizeProfile({ goal: 'study', at: 5 })).goal, 'study');
assert.strictEqual(J(ctx.sanitizeProfile({ goal: 'nope' })).goal, '', 'unknown goals become "no goal"');
assert.strictEqual(J(ctx.sanitizeProfile({ goal: 'constructor' })).goal, '', 'inherited property names are not goals');

for (const goal of ['study', 'projects', 'habits', 'explore', '', 'unknown']) {
  ctx.state = { tasks: [], habits: [], notes: [] };
  ctx.seedStarter(goal);
  const s = J(ctx.state);
  assert.ok(s.tasks.length >= 3 && s.habits.length >= 2 && s.notes.length === 1, goal + ': starter set size');
  assert.ok([...s.tasks, ...s.habits, ...s.notes].every(x => x.sample === true), goal + ': every starter item must be flagged sample');
  assert.strictEqual(new Set([...s.tasks, ...s.habits, ...s.notes].map(x => x.id)).size, s.tasks.length + s.habits.length + s.notes.length, goal + ': ids are unique');
  assert.ok(s.notes[0].title.startsWith('Welcome to NexOS'), goal + ': Clear sample data still recognises the welcome note');
  assert.ok(s.tasks.every(t => ['todo', 'inprogress'].includes(t.col) && ['low', 'medium', 'high'].includes(t.priority)), goal + ': valid columns and priorities');
}
ctx.state = { tasks: [], habits: [], notes: [] }; ctx.seedStarter('study');
assert.ok(J(ctx.state).tasks.some(t => t.title.includes('50-minute')), 'study starter mentions the 50-minute timer');
console.log('Quick-start rules (Classic) passed.');

// ---- Starter items use fixed ids, so two tabs seeding the same workspace cannot create duplicates ----
{
  const ids = goal => { ctx.state = { tasks: [], habits: [], notes: [] }; ctx.seedStarter(goal); const s = J(ctx.state); return [...s.tasks, ...s.habits, ...s.notes].map(x => x.id).join(','); };
  assert.strictEqual(ids('study'), ids('study'), 'seeding twice gives the same ids');
  assert.ok(ids('habits').split(',').every(id => /^qs-[thn]\d+$/.test(id)), 'starter ids are fixed');
}

// ---- Enterprise parity: same goals, timers and Home order as Classic; Settings change is non-destructive ----
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index-redesign.html'), 'utf8');
  const grab = (x, y) => { const i = html.indexOf(x); const j = html.indexOf(y, i); if (i < 0 || j < 0) throw new Error('Enterprise code not found: ' + x); return html.slice(i, j); };
  const els = {}; // fake dashboard cards, so the real ordering code can run
  const cards = {}; ['tasks', 'pomodoro', 'habits', 'notes'].forEach(k => { cards[k] = { style: {} }; });
  const sel = { value: '' };
  let saves = 0, toast = '';
  const ent = {
    uid: () => 'x', escapeHtml: t => t, showToast: m => { toast = m; }, saveWorkspaceState: () => { saves++; }, renderAllViews() { ent.applyEnterpriseHomeOrder(); }, pausePomodoro() {}, // the real renderAllViews redraws the dashboard
    
    document: { getElementById: id => id === 'setup-goal-select' ? sel : null, querySelector: q => { const m = /data-widget="(\w+)"/.exec(q); return m ? cards[m[1]] : null; } },
    enterpriseSession: { mode: 'account', ready: true, rootState: {} },
    state: { tasks: [{ id: 'mine' }], habits: [{ id: 'h' }], notes: [{ id: 'n' }], pomoRunning: false },
    console, Date, Object,
  };
  vm.createContext(ent);
  new vm.Script(grab('const ENTERPRISE_GOALS', 'function classicRootToEnterprise') + '\n' + grab('function enterpriseProfile()', 'function saveWorkspaceState()') + '\nthis.EG = ENTERPRISE_GOALS;').runInContext(ent);
  for (const k of Object.keys(ctx.GOALS)) {
    const c = ctx.GOALS[k], e = ent.EG[k];
    assert.ok(e, 'Enterprise has goal ' + k);
    assert.strictEqual(e.focus, c.timer.focus, k + ' focus minutes match Classic');
    assert.strictEqual(e.short, c.timer.short, k + ' short break matches Classic');
    assert.deepStrictEqual(J(e.home), J(c.home), k + ' Home order matches Classic');
  }
  ent.applyEnterpriseHomeOrder();
  assert.deepStrictEqual(['tasks', 'pomodoro', 'habits', 'notes'].map(k => cards[k].style.order), ['0', '1', '2', '3'], 'no goal keeps the default order');
  ent.enterpriseChangeGoal('study');
  assert.deepStrictEqual(['pomodoro', 'tasks', 'notes', 'habits'].map(k => cards[k].style.order), ['0', '1', '2', '3'], 'study puts Focus first');
  assert.strictEqual(ent.state.pomoTotalTime, 3000);
  assert.strictEqual(ent.enterpriseSession.pendingProfile.force, true, 'a Settings change must override the saved goal');
  assert.deepStrictEqual(J(ent.state.tasks), [{ id: 'mine' }], 'changing the goal never touches existing tasks');
  assert.strictEqual(ent.state.habits.length + ent.state.notes.length, 2);
  assert.strictEqual(sel.value, 'study');
  ent.state.pomoRunning = true; ent.state.pomoTotalTime = 777;
  ent.enterpriseChangeGoal('habits');
  assert.strictEqual(ent.state.pomoTotalTime, 777, 'a running timer is not reset');
  ent.enterpriseChangeGoal('bogus'); assert.strictEqual(saves, 2, 'unknown goals are ignored');
  console.log('Enterprise parity rules passed.');
}

// ---- A stale tab that seeds after another screen answered must not undo that screen's edits or deletions ----
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index-redesign.html'), 'utf8');
  const i = html.indexOf('function dropStaleStarterItems('), j = html.indexOf('function buildMergedRoot(', i);
  if (i < 0 || j < 0) throw new Error('dropStaleStarterItems not found');
  const c2 = { Map, Array, String }; vm.createContext(c2);
  new vm.Script(html.slice(i, j) + '\nthis.fn = dropStaleStarterItems;').runInContext(c2);
  const next = { tasks: [{ id: 'qs-t1', title: 'stale' }, { id: 'qs-t2', title: 'stale 2' }, { id: 'mine', title: 'mine' }], habits: [{ id: 'qs-h1' }], notes: [] };
  const remote = { tasks: [{ id: 'qs-t1', title: 'Complete OS Assignment' }], habits: [], notes: [] }; // t1 edited, t2 and h1 deleted elsewhere
  c2.fn(next, remote);
  assert.deepStrictEqual(J(next.tasks), [{ id: 'qs-t1', title: 'Complete OS Assignment' }, { id: 'mine', title: 'mine' }], 'edited starter item kept, deleted one stays deleted, own item kept');
  assert.deepStrictEqual(J(next.habits), [], 'a starter habit deleted elsewhere is not resurrected');
  console.log('Stale-tab seeding guard passed.');
}
