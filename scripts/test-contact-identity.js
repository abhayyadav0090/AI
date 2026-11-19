'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const contact = fs.readFileSync(path.join(root, 'public/contact.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const enterprise = fs.readFileSync(path.join(root, 'public/index-redesign.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const url of [
  'https://www.linkedin.com/in/abhayyadav19955/',
  'https://abhayyadav0090.github.io/portfolio2/',
  'https://github.com/abhayyadav0090',
  'mailto:abhayyadav19955@gmail.com',
  'https://github.com/abhayyadav0090/AI/issues'
]) assert.ok(contact.includes(url), `Contact page must include ${url}`);
assert.ok(index.includes('href="/contact.html"') && index.includes('>Contact</a>'), 'Classic login exposes Contact beside Privacy');
assert.ok(index.includes('id="profile-about-section"') && index.includes('href="/contact.html"'), 'Classic Settings exposes About & Contact');
assert.ok(enterprise.includes('href="/contact.html"') && enterprise.includes('About &amp; Contact'), 'Enterprise profile exposes About & Contact');
assert.ok(server.includes('cannot verify a user') && server.includes('Never invent, guess, infer, or disclose the creator'), 'server identity policy protects creator contact details and identity claims');
assert.ok(server.includes('workspace notes') && server.includes('/contact.html'), 'server policy rejects workspace notes as contact authority and directs to Contact page');
console.log('Creator Contact page and NexAI identity safeguards passed.');
