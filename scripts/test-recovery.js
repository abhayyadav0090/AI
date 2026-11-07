'use strict';
// Checks the Recently Deleted page (public/recover.html): one Close control, emerald Restore, empty state, safe text, retention and restore behaviour kept.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const page = read('public/recover.html');

// One Close control: the page has no Close button of its own; the host pages supply the grey one.
assert.ok(!/id="close"/.test(page), 'the page must not draw its own Close button');
assert.ok(!/closeButton/.test(page), 'no leftover Close button code');
assert.ok(read('public/app.js').includes('nexos-recover-close') && read('public/index-redesign.html').includes('nexos-recover-close'), 'Classic and Enterprise still provide the Close control');
assert.ok(page.includes("e.key === 'Escape'") && page.includes("type: 'nexos-recover-close'"), 'Esc closes the embedded panel');
assert.ok(/html\.embedded \.top \{[^}]*padding-right/.test(page), 'the header leaves room for the host Close button');

// Own design with emerald Restore in both themes.
assert.ok(/--emerald:\s*#10b981/i.test(page) && /--emerald:\s*#047857/i.test(page), 'emerald in dark and light themes');
assert.ok(/\.restore \{[^}]*background: var\(--emerald\)/.test(page), 'Restore buttons use the emerald colour');
assert.ok(!/#3b82f6/i.test(page), 'the old blue button colour is gone');
assert.ok(/id="empty"/.test(page) && page.includes('Nothing deleted recently'), 'there is an empty state');
assert.ok(/@media \(max-width: 520px\)/.test(page) && /\.item \.restore \{[^}]*width: 100%/.test(page), 'mobile layout stacks Restore full width');
assert.ok(/min-height: 44px/.test(page), 'touch targets are at least 44px');
assert.ok(page.includes('data-theme="light"') && page.includes('prefers-reduced-motion'), 'light theme and reduced motion are handled');

// Behaviour kept.
assert.ok(page.includes('30 * 864e5'), '30-day retention is kept');
assert.ok(page.includes("type: 'nexos-recover-changed'"), 'the host is still told after a restore');
assert.ok(page.includes('addBack(e.kind, it)') && page.includes("api('PUT', state)"), 'restoring still writes the item back to the account');
assert.ok(!page.includes('for (let i = 0; i < localStorage.length'), 'it never scans every localStorage key');
assert.ok(page.includes("knownKeys = new Set(["), 'only known cache keys are inspected');
assert.ok(page.includes("['/', '/classic', '/enterprise'].includes(parsed.pathname)"), 'the return link stays limited to NexOS routes');

// Item text is always set as text, never as markup.
const card = page.slice(page.indexOf('const card = ('), page.indexOf('let account;'));
assert.ok(card.includes('h.textContent = title') && !/innerHTML\s*=\s*(title|parts|label)/.test(card), 'titles are inserted as text');
assert.strictEqual((card.match(/innerHTML/g) || []).length, 1, 'only the fixed icon markup uses innerHTML');
console.log('Recovery page rules passed.');
