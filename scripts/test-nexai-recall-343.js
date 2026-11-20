#!/usr/bin/env node
'use strict';
// NexOS 3.4.3: recall mode, honest history-scope note, 60 s sign-in cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(pkg.version, '3.4.3');
assert.equal(lock.version, '3.4.3');
assert.equal(lock.packages[''].version, '3.4.3');

assert.match(server, /AUTH_CACHE_TTL_MS = 60000/, 'sign-in cache should last 60 seconds');
assert.match(server, /const recall = !isNewChat && wantsEarlierMessages\(typed\)/, 'recall mode is only for existing chats');
assert.match(server, /recall \? \{ title: 1, messages: 1 \} : \{ title: 1, messages: \{ \$slice: -CONTEXT_MESSAGES \} \}/, 'full chat is read only in recall mode');
assert.match(server, /historyScopeNote\(\{ recall, shown: history\.length, complete \}\)/, 'every request must tell NexAI how much history it sees');
assert.match(server, /Never blame a session reset, cache or memory failure/, 'NexAI must not invent reasons for missing history');
assert.match(server, /Never say 'you are my creator'/, 'creator identity safeguards must remain intact');
assert.doesNotMatch(server, /console\.info\([^\n]*(?:message|prompt|contents)/i, 'diagnostics must not log user content');

const start = server.indexOf('const RECALL_HISTORY_CHARS');
const end = server.indexOf("app.post('/api/chat'");
assert.ok(start > 0 && end > start, 'recall block must be found');
const ctx = { CONTEXT_MESSAGES: 24, MAX_CHAT_MESSAGES: 200, String, Array, Math };
vm.createContext(ctx);
vm.runInContext(server.slice(start, end) + '\nthis.api = { wantsEarlierMessages, buildHistory, historyScopeNote };', ctx);
const { wantsEarlierMessages, buildHistory, historyScopeNote } = ctx.api;

// Messages that should look back
[
  'my first message to NexAI',
  'ham kya discuss kar rahe the, our first chat which you remember',
  'there were more messages yesterday, fetch all exactly, approx 50 messages',
  'My All messages in a line which remember',
  'what did we discuss yesterday?',
  'What was my first message in this chat?',
  'pehla message kya tha',
  'kal raat humne kya baat ki thi',
  'show chat history',
  'what did I ask you before?',
].forEach((m) => assert.equal(wantsEarlierMessages(m), true, 'should recall: ' + m));

// Ordinary messages must stay on the fast path
[
  'hello',
  'who are you',
  'check time',
  'Essay on Mahatma Gandhi',
  'rahul gandhi',
  'Explain closures in JS',
  'make my schedule for tomorrow',
  'kal ka schedule bana do',
  'remember to submit the assignment',
  'start a new chat for COA lab',
  'what is the previous year question paper pattern',
].forEach((m) => assert.equal(wantsEarlierMessages(m), false, 'should stay fast: ' + m));
assert.equal(wantsEarlierMessages(''), false);
assert.equal(wantsEarlierMessages(undefined), false);

// History building
const make = (n, len = 10) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i + 'x'.repeat(len) }));
{
  const { history, complete } = buildHistory(make(50), false);
  assert.equal(history.length, 24);
  assert.equal(complete, false);
  assert.ok(history[history.length - 1].content.startsWith('m49'));
}
{
  const { history, complete } = buildHistory(make(50), true);
  assert.equal(history.length, 50, 'recall should include the whole short chat');
  assert.equal(complete, true);
  assert.ok(history[0].content.startsWith('m0'), 'oldest message first');
}
{
  const { history, complete } = buildHistory(make(200, 2500), true);
  assert.ok(history.length >= 24 && history.length < 200, 'recall must respect the size limit');
  assert.equal(complete, false);
  assert.ok(history[history.length - 1].content.startsWith('m199'), 'newest messages are kept');
}
{
  const { history } = buildHistory([{ role: 'user', content: 'a'.repeat(9000) }], true);
  assert.ok(history[0].content.length < 3100 && history[0].content.endsWith('...[trimmed]'), 'very long messages are shortened');
}
assert.equal(buildHistory([], false).history.length, 0);
assert.equal(buildHistory(undefined, true).history.length, 0);

// Scope notes
assert.match(historyScopeNote({ recall: false, shown: 24, complete: false }), /only up to the last 24 messages/);
assert.match(historyScopeNote({ recall: true, shown: 50, complete: true }), /complete saved history of this chat \(50 messages\)/);
assert.match(historyScopeNote({ recall: true, shown: 80, complete: false }), /too many or too long/);

console.log('NexOS 3.4.3 NexAI recall and history-scope checks passed.');
