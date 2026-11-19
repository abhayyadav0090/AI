#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
assert.match(source, /function simpleGreetingReply\(message\)/, 'server should define the lightweight greeting path');
assert.match(source, /const greetingReply = !files\.parts\.length \? simpleGreetingReply\(text\) : null;/, 'attachments must never use the greeting fast path');
assert.match(source, /if \(greetingReply\)[\s\S]*?path = 'greeting-fast-path'[\s\S]*?return res\.json\(/, 'greetings should return without calling Gemini');
assert.match(source, /auth-db;dur=/, 'timing should include authentication and its user lookup');
assert.match(source, /Server-Timing/ , 'chat responses should expose safe timing diagnostics');
assert.match(source, /\[NexAI timing\]/, 'server should log timing diagnostics');
assert.match(source, /if \(attempt < maxAttempts - 1\) await sleep\(1500\);/, 'no delay should occur after the final retry');
assert.match(source, /Never say 'you are my creator'/, 'creator identity claims must not be confirmed from chat');
assert.doesNotMatch(source, /console\.info\([^\n]*(?:message|prompt|contents)/i, 'diagnostics must not log user content');
console.log('NexAI performance and identity regression tests passed.');
