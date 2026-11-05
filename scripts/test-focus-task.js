'use strict';
// Checks the 2.5.8 "focus on a task" rules in Classic and Enterprise: logging, merging, and the start/finish flow.
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const app = read('app.js'), ent = read('index-redesign.html');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Not found: ' + a); return s.slice(i, j + b.length); };
const J = v => JSON.parse(JSON.stringify(v));

const H1 = '// ---- Focus-task helpers', H2 = '// ---- end Focus-task helpers ----';
assert.strictEqual(cut(app, H1, H2), cut(ent, H1, H2), 'shared helpers must be identical in Classic and Enterprise');

// Helpers
{
  const c = {}; vm.createContext(c);
  new vm.Script(cut(app, H1, H2) + '\nthis.map = nexFocusMinutesMap; this.entry = nexSessionEntry;').runInContext(c);
  const m = c.map({ pomodoroLog: [{ date: 'd', minutes: 25, taskId: 'a' }, { date: 'd', minutes: 50, taskId: 'a' }, { date: 'd', minutes: 25, taskId: 'b' }, { date: 'd', minutes: 25 }, { date: 'd', minutes: 0, taskId: 'c' }, { date: 'd', minutes: 'x', taskId: 'e' }, null] });
  assert.deepStrictEqual(J({ ...m }), { a: 75, b: 25 }, 'minutes add up per task; unbound, zero and invalid entries are ignored');
  assert.deepStrictEqual(J(c.map(null)), {}, 'missing state does not throw');
  assert.deepStrictEqual(J(c.entry('2026-11-05', 25, 'a', [{ id: 'a' }])), { date: '2026-11-05', minutes: 25, taskId: 'a' });
  assert.deepStrictEqual(J(c.entry('2026-11-05', 25, 'gone', [{ id: 'a' }])), { date: '2026-11-05', minutes: 25 }, 'a deleted task is not recorded');
  assert.deepStrictEqual(J(c.entry('2026-11-05', 25, '', [{ id: 'a' }])), { date: '2026-11-05', minutes: 25 });
  assert.strictEqual(c.map({ pomodoroLog: [{ taskId: '__proto__', minutes: 5 }] }).__proto__, 5, 'odd ids cannot pollute prototypes');
}

// Enterprise data adapters keep taskId, and the merge treats sessions on different tasks as different sessions
{
  const i0 = ent.indexOf('function safeEnterpriseStage(value)');
  const a = ent.slice(i0, ent.indexOf('function enterpriseLocalKey()', i0));
  const c = { state: { tasks: [], habits: [], notes: [], pomodoroLog: [], pomodoroStats: {}, currentNoteId: null }, uid: () => 'x', console };
  vm.createContext(c);
  new vm.Script(a).runInContext(c);
  const root = { tasks: [], habits: [], notes: [], pomodoroLog: [{ date: '2026-11-05', minutes: 25, taskId: 'qs-t1' }, { date: '2026-11-05', minutes: 25 }], pomodoroStats: {} };
  const e = c.classicRootToEnterprise(root, {});
  assert.deepStrictEqual(J(e.pomodoroLog), [{ date: '2026-11-05', minutes: 25, taskId: 'qs-t1' }, { date: '2026-11-05', minutes: 25 }], 'Classic to Enterprise keeps taskId');
  c.state = e;
  const back = c.enterpriseToClassicRoot(root);
  assert.deepStrictEqual(J(back.pomodoroLog), J(e.pomodoroLog), 'Enterprise to Classic keeps taskId');
  const L = (taskId) => ({ date: '2026-11-05', minutes: 25, ...(taskId ? { taskId } : {}) });
  let out = c.mergeLogs([L('a')], [L('a'), L('b')], [L('a')]);
  assert.deepStrictEqual(J(out), [L('a'), L('b')], 'a session on another task is added, not mistaken for a duplicate');
  out = c.mergeLogs([L('a'), L('b')], [L('a')], [L('a')]);
  assert.deepStrictEqual(J(out), [L('a'), L('b')], 'a stale screen does not duplicate or drop sessions');
  out = c.mergeLogs([L('a')], [L('a'), L('a')], [L('a')]);
  assert.strictEqual(out.length, 2, 'two sessions on the same task in one sitting both count');
}

// Classic sanitizer keeps taskId
assert.ok(/minutes: Number\(l\.minutes\), \.\.\.\(l\.taskId \? \{ taskId: String\(l\.taskId\)\.slice\(0, 80\) \} : \{\}\)/.test(app), 'Classic normalizeState keeps taskId');

// Flow tests (real functions, stubbed page)
function flow(kind) {
  const src = kind === 'classic' ? app : ent;
  const actions = cut(src, '// ---- Focus-task actions (' + (kind === 'classic' ? 'Classic' : 'Enterprise') + ') ----', '// ---- end Focus-task actions ----');
  const calls = [], slots = [{ innerHTML: '' }, { innerHTML: '' }];
  const c = { calls, slots, Object, Array, Number, String,
    document: { querySelectorAll: () => slots },
    escHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'), escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    today: () => '2026-11-05', notify: m => calls.push('notify:' + m), showToast: m => calls.push('toast:' + m),
    setTaskCol: (t, col) => { t.col = col; }, saveState() { calls.push('save'); }, saveWorkspaceState() { calls.push('save'); },
    renderKanban() {}, renderDashboard() {}, updateStats() {}, updateContextPanel() {}, renderAnalytics() {}, renderCalendarTimeline() {}, playHarmonicChime() { calls.push('chime'); },
    switchView: v => calls.push('view:' + v), switchNexusView: v => calls.push('view:' + v),
    togglePomodoro() { calls.push('toggle'); c.pomState.running = !c.pomState.running; },
    startPomodoro() { calls.push('start'); c.state.pomoRunning = true; },
    setMode: m => { c.pomState.mode = m; c.pomState.remaining = c.pomDurations[m] * 60; },
    setPomodoroMode: m => { c.state.pomoMode = m; c.state.pomoRunning = false; c.state.pomoTotalTime = c.pomDurations[m] * 60; c.state.pomoTimeRemaining = c.state.pomoTotalTime; },
    pomDurations: { focus: 50, short: 10, long: 20 },
    pomState: { mode: 'focus', remaining: 3000, running: false },
    state: { tasks: [{ id: 't1', title: 'Write <report>', col: 'todo', stage: 'todo' }, { id: 't2', title: 'Other', col: 'todo', stage: 'todo' }], pomodoroLog: [], pomoMode: 'focus', pomoTotalTime: 3000, pomoTimeRemaining: 3000, pomoRunning: false } };
  vm.createContext(c);
  new vm.Script(src.slice(src.indexOf('// ---- Focus-task helpers'), src.indexOf('// ---- end Focus-task helpers ----')) + actions + '\nthis.f = { on: focusOnTask, log: focusLogSession, finish: focusFinishTask, keep: focusKeepGoing, clear: clearFocusTask, render: renderFocusTask, get id() { return focusTaskId; }, get prompt() { return focusPromptId; } };').runInContext(c);
  return c;
}
for (const kind of ['classic', 'enterprise']) {
  const stageKey = kind === 'classic' ? 'col' : 'stage';
  const c = flow(kind), t = i => c.state.tasks[i];
  c.f.on('t1');
  assert.strictEqual(c.f.id, 't1', kind + ': task is bound');
  assert.strictEqual(t(0)[stageKey], 'inprogress', kind + ': a To Do task moves to In Progress');
  assert.ok(c.calls.includes(kind === 'classic' ? 'toggle' : 'start') && c.calls.includes('view:' + (kind === 'classic' ? 'pomodoro' : 'focus')), kind + ': timer starts and the focus screen opens');
  assert.ok(c.slots[0].innerHTML.includes('Focusing on <strong>Write &lt;report&gt;</strong>'), kind + ': title shown and escaped');
  c.calls.length = 0; c.f.on('t2');
  assert.ok(c.calls.some(x => /^(notify|toast):A timer is already in progress/.test(x)), kind + ': cannot bind a second task while one runs');
  assert.strictEqual(c.f.id, 't1', kind + ': binding unchanged');
  c.f.log(50);
  assert.deepStrictEqual(J(c.state.pomodoroLog), [{ date: '2026-11-05', minutes: 50, taskId: 't1' }], kind + ': session logged with the task');
  assert.strictEqual(c.f.prompt, 't1'); assert.ok(c.slots[0].innerHTML.includes('Mark done') && c.slots[0].innerHTML.includes('Keep going'), kind + ': finish prompt shown');
  c.f.keep();
  assert.strictEqual(c.f.id, 't1', kind + ': Keep going leaves the task bound'); assert.strictEqual(c.f.prompt, '');
  assert.ok(c.slots[0].innerHTML.includes('50 min so far'), kind + ': minutes so far shown');
  c.f.log(50); c.f.finish();
  assert.strictEqual(t(0)[stageKey], 'done', kind + ': Mark done completes the task');
  assert.strictEqual(c.f.id, '', kind + ': binding cleared after Mark done'); assert.strictEqual(c.slots[0].innerHTML, '');
  assert.strictEqual(c.state.pomodoroLog.filter(l => l.taskId === 't1').reduce((s, l) => s + l.minutes, 0), 100);
  // Task removed or finished mid-session: minutes still counted when the task exists, prompt skipped when done
  const d = flow(kind);
  d.f.on('t1'); d.state.tasks[0][stageKey] = 'done'; d.f.log(50);
  assert.strictEqual(d.state.pomodoroLog[0].taskId, 't1', kind + ': minutes still go to a task finished mid-session');
  assert.strictEqual(d.f.prompt, '', kind + ': no prompt for a task that is already done');
  const g = flow(kind);
  g.f.on('t1'); g.state.tasks.splice(0, 1); g.f.log(50);
  assert.deepStrictEqual(J(g.state.pomodoroLog), [{ date: '2026-11-05', minutes: 50 }], kind + ': a deleted task is not recorded');
  assert.strictEqual(g.slots[0].innerHTML, '', kind + ': nothing shown for a deleted task');
  // Resume the same task after pausing mid-session; refuse a different one
  const p = flow(kind);
  p.f.on('t1');
  if (kind === 'classic') { p.pomState.running = false; p.pomState.remaining = 1000; } else { p.state.pomoRunning = false; p.state.pomoTimeRemaining = 1000; }
  p.calls.length = 0; p.f.on('t1');
  assert.ok(p.calls.includes(kind === 'classic' ? 'toggle' : 'start'), kind + ': resuming the same task restarts the timer');
  p.f.clear(); assert.strictEqual(p.f.id, '');
  // Done tasks cannot be focused
  const q = flow(kind); q.state.tasks[1][stageKey] = 'done'; q.f.on('t2');
  assert.strictEqual(q.f.id, '', kind + ': a done task cannot be focused');
}

// Wiring: buttons, slots and cleanup are present in both views
assert.ok(app.includes("focusOnTask('${t.id}')") && app.includes('focusLogSession(mins);') && /if \(focusTaskId === id\)/.test(app), 'Classic wiring');
assert.ok(ent.includes("focusOnTask('${t.id}')") && ent.includes('focusLogSession(mins);') && /if \(focusTaskId === id\)/.test(ent), 'Enterprise wiring');
assert.strictEqual((read('index.html').match(/pomo-task-slot/g) || []).length, 2, 'Classic has two slots (Home card and Focus screen)');
assert.strictEqual((ent.match(/<div class="pomo-task-slot"/g) || []).length, 2, 'Enterprise has two slots');
console.log('Focus-on-a-task rules passed.');
