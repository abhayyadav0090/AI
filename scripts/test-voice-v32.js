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
assert.ok(ent.includes('3.2.0: on phones the NexAI chat gets most of the screen') && ent.includes('height: calc(100dvh - 270px); min-height: 420px'), 'mobile NexAI chat should be taller');

// Recovery Center stays untouched.
assert.ok(!recover.includes('nexos-mic') && !recover.includes('SpeechRecognition'), 'Recovery Center must not contain voice code');

// Version consistency.
const pkg = JSON.parse(read('package.json'));
assert.strictEqual(pkg.version, '3.2.0', 'package version must be 3.2.0');
assert.ok(read('RELEASE-NOTES/RELEASE-NOTES NexOS 3.0/RELEASE-NOTES-3.2.0.md').startsWith('# NexOS 3.2.0'), '3.2.0 release notes should be present');
assert.ok(read('README.md').includes('Current source release: 3.2.0'), 'README should identify 3.2.0');

console.log('NexOS 3.2.0 voice input checks passed.');
