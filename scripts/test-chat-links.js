#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = source.indexOf('function formatChat(text) {');
const end = source.indexOf('\nfunction appendChatMsg', start);
assert(start >= 0 && end > start, 'formatChat renderer must exist');
const escHtml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const context = { escHtml };
vm.runInNewContext(source.slice(start, end) + '\nthis.render = formatChat;', context);
const render = context.render;

const absolute = render('Visit [Open Contact Page](https://ai-aqit.onrender.com/contact.html)');
assert.match(absolute, /<a href="https:\/\/ai-aqit\.onrender\.com\/contact\.html" target="_blank" rel="noopener noreferrer">Open Contact Page<\/a>/);
const relative = render('Go to [Contact](/contact.html)');
assert.match(relative, /<a href="\/contact\.html">Contact<\/a>/);
const bare = render('Visit https://example.com/help.');
assert.match(bare, /<a href="https:\/\/example\.com\/help" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/help<\/a>\./);
const unsafe = render('[bad](javascript:alert(1))');
assert.doesNotMatch(unsafe, /<a\b/i);
const escaped = render('<img src=x onerror=alert(1)>');
assert.match(escaped, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(escaped, /<img\b/i);
const code = render('`https://example.com`');
assert.match(code, /<code>https:\/\/example\.com<\/code>/);
assert.doesNotMatch(code, /<code><a\b/);
console.log('Chat link rendering tests passed.');
