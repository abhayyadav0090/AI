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
assert.ok(classicVoice.includes('// Do not focus the field here: mobile browsers may open the keyboard after dictation.'), 'Classic dictation must not refocus the input after speech recognition');
assert.ok(classicVoice.includes('field.blur(); // Keep the mobile keyboard closed while the microphone is listening.'), 'Classic dictation should explicitly blur the input while listening');

assert.ok(enterprise.includes('let enterpriseChatSending = false;'), 'Enterprise must use one shared send lock');
assert.ok((enterprise.match(/if \(enterpriseChatSending\) return;/g) || []).length >= 2, 'Both Enterprise chat send entry points must reject overlapping sends');
assert.ok(enterprise.includes("input.dispatchEvent(new Event('input', { bubbles: true }));"), 'Enterprise composer clear must notify input listeners');
assert.ok(enterprise.includes('if (!sent && input && !input.value.trim())'), 'Enterprise must restore the original message after a failed request only when the composer is still empty');
assert.ok(enterprise.includes('// Keep focus on the microphone; focusing this field opens the mobile keyboard.'), 'Enterprise dictation must not refocus the input after speech recognition');
assert.ok(enterprise.includes('field.blur(); // Keep the mobile keyboard closed while the microphone is listening.'), 'Enterprise dictation should explicitly blur the input while listening');

const voiceStart = enterprise.indexOf('function toggleVoiceDictation(target, btn)');
const voiceEnd = enterprise.indexOf('// Long-press a mic button', voiceStart);
assert.ok(voiceStart >= 0 && voiceEnd > voiceStart);
assert.ok(!enterprise.slice(voiceStart, voiceEnd).includes('field.focus()'), 'Enterprise voice handler must not programmatically focus the input');
assert.ok(!recover.includes('field.focus') && !recover.includes('enterpriseChatSending'), 'Recovery Center must remain untouched');

console.log('NexOS 3.3.2 mobile voice and send regression checks passed.');
