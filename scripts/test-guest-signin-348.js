const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/design.css');
const ent = read('public/index-redesign.html');

// Classic: guest Sign in pill between the page title and search, same action as the dashboard banner
assert.ok(/id="topbar-signin"[^>]*onclick="logout\(\)"/.test(html), 'Classic top bar needs a Sign in button that runs logout()');
assert.ok(html.indexOf('id="breadcrumb"') < html.indexOf('id="topbar-signin"') && html.indexOf('id="topbar-signin"') < html.indexOf('class="topbar-search"'), 'Sign in pill must sit between the title and search');
assert.ok(app.includes("classList.toggle('has-signin', !!user.guest)"), 'only guests may get the Sign in pill');
assert.ok(css.includes('.topbar.has-signin .topbar-signin { display: inline-flex;') && css.includes('.topbar-signin { display: none; }'), 'pill is hidden unless the guest class is set');
assert.ok(css.includes('.sync-chip[data-state="local"] { display: none; }'), 'guest sync dot should be hidden on phones');
assert.ok(app.includes('class="btn-sm" onclick="logout()">Sign in</button>'), 'dashboard guest banner must keep its Sign in button');

// Enterprise: Glass no longer shares violet with Violet Orchid
const glass = ent.match(/:root, \[data-theme="apple-dark"\] \{[\s\S]*?\n\}/)[0];
assert.ok(glass.includes('--accent-secondary: #64D2FF;') && !/#BF5AF2|#5E5CE6/.test(glass), 'Glass should be blue/cyan, not violet');
assert.ok(ent.includes('data-theme-key="apple-dark"') && ent.includes('--sw-accent2:#64D2FF'), 'Glass preview card must show the cyan secondary');
console.log('NexOS 3.4.8 guest sign-in and Glass theme checks passed.');
