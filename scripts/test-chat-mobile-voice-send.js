// NexOS 3.3.2 regression checks for mobile dictation and duplicate NexAI submissions.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const classic = read('public/app.js');
const classicVoice = read('public/ui.js');
const enterprise = read('public/index-redesign.html');
const recover = read('public/recover.html');

assert.ok(classic.includes('if (chatBusy) return;'), 'Classic must reject duplicate sends while a request is in flight');
assert.ok(classic.includes("const msg = input.value.trim();") && classic.includes("input.value = '';"), 'Classic must clear its composer on send');
assert.ok(classic.includes('chatBusy = true;'), 'Classic must acquire its send lock before awaiting the API');
assert.ok(classicVoice.includes('field.readOnly = true;'), 'Classic chat input must be read-only during dictation to suppress Android keyboard reopening');
assert.ok(classicVoice.includes("field.setAttribute('inputmode', 'none');"), 'Classic voice guard must suppress the software keyboard');
assert.ok(classicVoice.includes("field.addEventListener('pointerdown'"), 'Classic voice guard must restore editing on a deliberate field tap');

assert.ok(enterprise.includes('let enterpriseChatSending = false;'), 'Enterprise must use one shared send lock');
assert.ok((enterprise.match(/if \(enterpriseChatSending\) return;/g) || []).length >= 2, 'Both Enterprise chat send entry points must reject overlapping sends');
assert.ok(enterprise.includes("input.dispatchEvent(new Event('input', { bubbles: true }));"), 'Enterprise composer clear must notify input listeners');
assert.ok(enterprise.includes('if (!sent && input && !input.value.trim())'), 'Enterprise must restore the original message after a failed request only when the composer is still empty');
assert.ok(enterprise.includes('function prepareVoiceKeyboardGuard(field)'), 'Enterprise must use a dedicated mobile keyboard guard');
assert.ok(enterprise.includes('field.readOnly = true;') && enterprise.includes("field.setAttribute('inputmode', 'none');"), 'Enterprise chat input must suppress the keyboard during dictation');
assert.ok(enterprise.includes("field.addEventListener('pointerdown'"), 'Enterprise voice guard must restore editing on a deliberate field tap');
assert.ok(enterprise.includes("document.documentElement.classList.toggle('nexos-ai-view-active', name === 'ai')"), 'Enterprise must track when the AI view is active');
assert.ok(enterprise.includes('html.nexos-ai-view-active #nexus-app') && enterprise.includes('body.nexos-ai-view-active #pane-ai .ai-chat-messages-box'), 'Enterprise AI mobile layout must stay bounded inside the viewport');

const voiceStart = enterprise.indexOf('function toggleVoiceDictation(target, btn)');
const voiceEnd = enterprise.indexOf('// Long-press a mic button', voiceStart);
assert.ok(voiceStart >= 0 && voiceEnd > voiceStart);
assert.ok(!enterprise.slice(voiceStart, voiceEnd).includes('field.focus()'), 'Enterprise voice handler must not programmatically focus the input');
assert.ok(enterprise.includes('prepareVoiceKeyboardGuard(field);'), 'Enterprise dictation must activate the keyboard guard before recognition starts');
assert.ok(!recover.includes('field.focus') && !recover.includes('enterpriseChatSending'), 'Recovery Center must remain untouched');

console.log('NexOS 3.3.2 mobile voice and send regression checks passed.');
