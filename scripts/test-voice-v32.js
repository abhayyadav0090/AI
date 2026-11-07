// Checks NexOS 3.2.0 voice input: Classic mic module, Enterprise mic buttons, safe defaults, Recovery Center untouched.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ui = read('public/ui.js');
const classic = read('public/index.html');
const app = read('public/app.js');
const ent = read('public/index-redesign.html');
const recover = read('public/recover.html');

// Classic: every voice target id exists in the markup (or is created by Action Mode) and the module guards unsupported browsers.
['chat-input', 'new-task-input', 'modal-title-input', 'modal-desc-input'].forEach((id) => {
  assert.ok(classic.includes('id="' + id + '"'), 'Classic field ' + id + ' must exist');
  assert.ok(ui.includes("id: '" + id + "'"), 'Classic voice module must target ' + id);
});
assert.ok(app.includes('id="nexos-action-request"') && ui.includes("id: 'nexos-action-request'"), 'Classic Action Mode field must get a mic');
assert.ok(ui.includes('window.SpeechRecognition || window.webkitSpeechRecognition') && ui.includes('if (!SR) return;'), 'Classic voice must be skipped when unsupported');
assert.ok(ui.includes('MutationObserver'), 'Classic voice must attach to dynamically created Action Mode dialog');
assert.ok(ui.includes('field.maxLength'), 'Classic voice must respect field length limits');
assert.ok(!/\.submit\(|sendMessage\(|addTask\(/.test(ui.slice(ui.indexOf('NexOS 3.2.0 voice input'))), 'Classic voice must never auto-submit');

// Enterprise: generic dictation plus mics for Action Mode, task dialog and all four quick-add inputs.
assert.ok(ent.includes('function toggleVoiceDictation(target, btn)'), 'Enterprise dictation must accept any target');
['action-mode-input-text', 'task-modal-title', 'task-modal-desc', 'floating-chat-input'].forEach((id) => {
  assert.ok(ent.includes("toggleVoiceDictation('" + id + "', this)"), 'Enterprise mic for ' + id + ' must exist');
});
assert.strictEqual((ent.match(/toggleVoiceDictation\('prev', this\)/g) || []).length, 4, 'one mic per Kanban quick-add input');
assert.ok(ent.includes("toggleVoiceDictation('chat')") && ent.includes("toggleVoiceDictation('note')"), 'existing chat and note mics must keep working');
assert.ok(ent.includes("nexos_voice_lang"), 'voice language must be remembered');
assert.ok(!/\.submit\(/.test(ent.slice(ent.indexOf('Voice Dictation (Web Speech API)'), ent.indexOf('// ---------------- ACTION MODE'))), 'Enterprise voice must never auto-submit');

// Mobile NexAI chat layout: tall chat box, desktop rules untouched.
assert.ok(ent.includes('3.3.1: on phones NexAI gets one compact row of 4 buttons') && ent.includes('height: calc(100dvh - 202px - env(safe-area-inset-bottom, 0px)); min-height: 300px'), 'mobile NexAI chat should be taller');

// Recovery Center stays untouched.
assert.ok(!recover.includes('nexos-mic') && !recover.includes('SpeechRecognition'), 'Recovery Center must not contain voice code');

assert.ok(fs.existsSync(path.join(__dirname, '..', 'RELEASE-NOTES/RELEASE-NOTES NexOS 3.0/RELEASE-NOTES-3.2.0.md')), '3.2.0 release notes should be kept');

// Repeat-text guard: results must be rebuilt from the whole event on top of the text that was there before the mic, never appended.
assert.ok(ent.includes('function nexosSpokenText') && ent.includes('const transcript = nexosSpokenText(e.results)') && ent.includes('baseText + transcript'), 'Enterprise mic must rewrite the field instead of appending each result');
assert.ok(ui.includes('function spokenText') && ui.includes('const text = spokenText(e.results)') && ui.includes('baseText + text'), 'Classic mic must rewrite the field instead of appending each result');

console.log('NexOS 3.2.0 voice input checks passed.');
