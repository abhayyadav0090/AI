const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// pull one top-level function's source out of a page script
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
function run(src, { enterprise }) {
  const logs = { saved: 0, toasts: [], rendered: 0 };
  const els = {};
  const state = { habits: [{ id: 'h1', name: 'Read', color: enterprise ? 'var(--accent-primary)' : '#4285F4', checks: { '2026-11-24': true }, streak: 3 }, { id: 'h2', name: 'Run', color: '#34A853', checks: {}, streak: 0 }] };
  const ctx = {
    state, editingHabitId: null, escHtml: (s) => String(s), escapeHtml: (s) => String(s),
    habitColor: (h) => h.color, document: { getElementById: (id) => els[id] || null, querySelectorAll: () => [] },
    saveState() { logs.saved++; }, saveWorkspaceState() { logs.saved++; }, renderHabits() { logs.rendered++; }, renderDashboard() {}, updateStats() {}, updateContextPanel() {}, renderAnalytics() {},
    notify: (m) => logs.toasts.push(m), showToast: (m) => logs.toasts.push(m)
  };
  const names = ['habitEditBar', 'startEditHabit', 'cancelEditHabit', 'habitEditKey', 'applyHabitFields', 'refreshHabitViews', 'saveEditHabit'].concat(enterprise ? ['habitHexColor'] : []);
  vm.createContext(ctx);
  vm.runInContext('var editingHabitId = null; var habitDetailId = null;\n' + names.map((n) => fn(src, n)).join('\n'), ctx);
  return { ctx, els, logs, state };
}
for (const enterprise of [false, true]) {
  const src = enterprise ? read('public/index-redesign.html') : read('public/app.js');
  const t = run(src, { enterprise });
  t.els['habit-edit-name'] = { value: '  Read 30 pages  ', focus() {}, select() {} };
  t.els['habit-edit-color'] = enterprise ? { value: '#4285f4', dataset: { initial: 'var(--accent-primary)' } } : { value: '#A142F4' };
  t.ctx.startEditHabit('h1');
  assert.strictEqual(t.ctx.editingHabitId, 'h1', 'edit starts');
  t.ctx.saveEditHabit('h1');
  const h = t.state.habits[0];
  assert.strictEqual(h.name, 'Read 30 pages', 'name trimmed and saved');
  assert.deepStrictEqual(h.checks, { '2026-11-24': true }); assert.strictEqual(h.streak, 3); assert.strictEqual(h.id, 'h1');
  assert.strictEqual(h.color, enterprise ? 'var(--accent-primary)' : '#A142F4', enterprise ? 'unchanged picker keeps the theme colour' : 'colour updated');
  assert.strictEqual(t.ctx.editingHabitId, null); assert.ok(t.logs.saved >= 1); assert.ok(t.logs.toasts.includes('Habit updated'));
  // empty name is rejected and nothing changes
  t.els['habit-edit-name'].value = '   '; t.ctx.editingHabitId = 'h2'; const before = t.logs.saved;
  t.ctx.saveEditHabit('h2');
  assert.strictEqual(t.state.habits[1].name, 'Run'); assert.strictEqual(t.logs.saved, before); assert.strictEqual(t.ctx.editingHabitId, 'h2');
  // length limit
  t.els['habit-edit-name'].value = 'x'.repeat(200); t.ctx.saveEditHabit('h2');
  assert.strictEqual(t.state.habits[1].name.length, 80);
  // Esc cancels, Enter saves
  t.ctx.startEditHabit('h2'); t.ctx.habitEditKey({ key: 'Escape', preventDefault() {} }, 'h2'); assert.strictEqual(t.ctx.editingHabitId, null);
  if (enterprise) { t.els['habit-edit-color'].value = '#ea4335'; t.ctx.startEditHabit('h2'); t.els['habit-edit-name'].value = 'Run'; t.ctx.habitEditKey({ key: 'Enter', preventDefault() {} }, 'h2'); assert.strictEqual(t.state.habits[1].color, '#ea4335', 'picked colour is saved'); }
}
// wiring
const classic = read('public/app.js'), ent = read('public/index-redesign.html');
assert.ok(classic.includes('onclick="startEditHabit(\'${h.id}\')"') && classic.includes("editingHabitId === h.id ? habitEditBar(h)"), 'Classic edit button and bar');
assert.ok(ent.includes('onclick="startEditHabit(\'${h.id}\')"') && ent.includes("editingHabitId === h.id ? habitEditBar(h)"), 'Enterprise edit button and bar');
assert.ok(read('public/style.css').includes('.habit-edit-btn') && ent.includes('.habit-edit-bar'), 'styles');
assert.ok(classic.includes('if (editingHabitId === id) editingHabitId = null;') && ent.includes('if (editingHabitId === id) editingHabitId = null;'), 'deleting a habit closes its edit bar');
assert.ok(read('public/recover.html').length > 1000);
console.log('NexOS 4.2.0 habit editing checks passed.');
