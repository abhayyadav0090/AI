// NexOS 3.3.3: phone NexAI page fits the screen, and dictation keeps the keyboard closed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ui = read('public/ui.js');
const ent = read('public/index-redesign.html');

// Keyboard: both voice paths release focus first, block the keyboard while listening, and let go only after a short delay or a tap.
[[ui, 'holdKeyboardClosed(field)', 'Classic'], [ent, 'nexosHoldKeyboardClosed(field)', 'Enterprise']].forEach(([src, call, name]) => {
  assert.ok(src.includes(call), name + ' dictation must hold the keyboard closed');
  assert.ok(src.includes("field.setAttribute('inputmode', 'none')") && src.includes('field.blur()'), name + ' must blur and block the keyboard');
  assert.ok(src.includes("addEventListener('pointerdown', onTap)"), name + ' must give the keyboard back when the user taps the field');
  assert.ok(src.includes('setTimeout(restore, 900)') && src.includes('kb.release()'), name + ' must release only after speech ends');
});
const voice = ent.slice(ent.indexOf('function toggleVoiceDictation(target, btn)'), ent.indexOf('// Long-press a mic button'));
assert.ok(!voice.includes('field.focus()'), 'dictation must never focus the field');

// Layout: the page is sized from the real top bar and never scrolls on phones; only the chat does.
assert.ok(ent.includes('function syncTopbarHeight()') && ent.includes("setProperty('--nex-topbar-h'"), 'top bar height must be measured');
assert.ok(ent.includes("document.documentElement.classList.toggle('view-ai-active', name === 'ai')"), 'NexAI view must mark the page');
const css = ent.slice(ent.indexOf('/* 3.3.3: on phones the NexAI page fits the screen exactly.'));
assert.ok(/max-width: 768px/.test(css.slice(0, 200)), 'fit rules are phone-only');
['html.view-ai-active, html.view-ai-active body { overflow: hidden', 'height: calc(100dvh - var(--nex-topbar-h, 56px))', '.ai-chat-main-container { flex: 1; height: auto; min-height: 0'].forEach((rule) => assert.ok(css.includes(rule), 'missing: ' + rule));

// Recovery Center stays untouched.
assert.ok(!read('public/recover.html').includes('view-ai-active') && !read('public/recover.html').includes('inputmode'), 'Recovery Center must not change');
console.log('NexOS 3.3.3 NexAI fit and keyboard checks passed.');
