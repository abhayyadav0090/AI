'use strict';
// Checks the folded Settings page and the Home setup card: every id the code uses exists once, sections start closed, helper rules.
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// 1. Every Settings / reminders / Home-setup id that app.js looks up exists exactly once in index.html.
const wanted = new Set();
for (const m of app.matchAll(/getElementById\('((?:profile-|ps-sum-|task-reminder|save-reminder|reminder-zone|home-setup|import-file-input)[\w-]*)'\)/g)) wanted.add(m[1]);
assert.ok(wanted.size >= 15, 'expected to find the Settings ids in app.js');
for (const id of wanted) assert.strictEqual(html.split('id="' + id + '"').length - 1, 1, 'id "' + id + '" must exist exactly once in index.html');

// 2. Settings structure: six folded sections, each with a summary row, none open by default; dangerous ones included.
const modal = html.slice(html.indexOf('id="profile-modal"'), html.indexOf('<!-- KEYBOARD SHORTCUTS -->'));
const folds = [...modal.matchAll(/<details class="([^"]*)" id="([^"]+)"([^>]*)>\s*<summary>/g)];
assert.deepStrictEqual(folds.map(f => f[2]), ['profile-appearance', 'profile-experience', 'profile-reminders-section', 'profile-data-section', 'profile-guest-section', 'profile-delete-section']);
assert.ok(folds.every(f => !/\bopen\b/.test(f[3])), 'no section starts open');
assert.strictEqual((modal.match(/<\/details>/g) || []).length, 6, 'every details is closed');
assert.ok(modal.indexOf('id="profile-setup-section"') < modal.indexOf('id="profile-appearance"'), 'Your setup sits above the folded sections');
assert.ok(modal.indexOf('id="profile-setup-section"') > modal.indexOf('id="profile-name-section"'), 'Your setup sits right under the name');
assert.ok(/id="profile-name-save"[^>]*hidden/.test(modal), 'the Save name button stays hidden until the name changes');
assert.strictEqual((modal.match(/Download my data/g) || []).length, 1, 'only one data download control');
assert.ok(!modal.includes('onclick="exportData()"'), 'no second export button');
assert.ok(modal.includes('id="profile-download-btn"') && modal.includes('importData(event)') && modal.includes('/recover.html'), 'download, restore and recently deleted are all still reachable');
assert.ok(/class="design-picker desk-only"/.test(modal) && (modal.match(/class="design-card"/g) || []).length === 2, 'the big Google/Apple preview cards are kept for laptops');
assert.ok(/class="seg seg-wide mob-only"[^>]*aria-label="Design"/.test(modal), 'the compact design buttons are for phones');
assert.ok(app.includes("matchMedia('(min-width: 901px)')") && app.includes('function applySettingsLayout()'), 'laptop/phone layout is decided by width');
assert.ok(html.includes('id="home-setup-card"') && html.includes('homeSetupDismiss()'), 'Home setup card is present');

// 3. Helper rules.
const grab = (a, b) => { const i = app.indexOf(a), j = app.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return app.slice(i, j); };
const ctx = { GOALS: { study: { label: 'S' } }, state: { seeded: true, profile: null }, notes: [], Date, Object };
ctx.notify = m => ctx.notes.push(m); ctx.saveState = () => { ctx.saved = true; }; ctx.renderHomeSetupCard = () => {};
vm.createContext(ctx);
new vm.Script(grab('function appearanceSummary(', 'function renderHomeSetupCard(') + grab('function homeSetupDismiss()', 'function refreshProfileSummaries()') + '\nthis.f = { appearanceSummary, reminderSummary, needsHomeSetup, homeSetupDismiss };').runInContext(ctx);
const f = ctx.f;
assert.strictEqual(f.appearanceSummary('apple', 'dark'), 'Apple · Dark');
assert.strictEqual(f.appearanceSummary(undefined, 'system'), 'Google · Match device');
assert.strictEqual(f.reminderSummary(false, '21:00'), 'Off');
assert.strictEqual(f.reminderSummary(true, '21:00'), 'On, daily at 21:00');
assert.strictEqual(f.reminderSummary(true, 'bad'), 'On, daily at 09:00');
assert.strictEqual(f.needsHomeSetup({ seeded: true, profile: null }), true, 'existing account with no goal gets the card');
assert.strictEqual(f.needsHomeSetup({ seeded: false, profile: null }), false, 'a brand-new workspace gets the quick-start instead');
assert.strictEqual(f.needsHomeSetup({ seeded: true, profile: { goal: '' } }), false, 'a dismissed card stays dismissed');
assert.strictEqual(f.needsHomeSetup({ seeded: true, profile: { goal: 'study' } }), false);
assert.strictEqual(f.needsHomeSetup(null), false);
f.homeSetupDismiss();
assert.strictEqual(ctx.state.profile.goal, '', 'dismissing stores "no goal", which Classic and Enterprise both treat as answered');
assert.strictEqual(ctx.saved, true);
// A class that sets `display` beats the hidden attribute, so every hidden-by-attribute card needs its own rule.
const ent = fs.readFileSync(path.join(root, 'index-redesign.html'), 'utf8');
assert.ok(/#qs-card\[hidden\]\s*\{\s*display:\s*none/.test(ent), 'Enterprise quick-start card must really hide (dash-card sets display:flex)');
assert.ok(/\.setup-card\[hidden\]\s*\{\s*display:\s*none/.test(fs.readFileSync(path.join(root, 'style.css'), 'utf8')), 'Classic Home setup card must really hide');
assert.ok(/\.profile-modal \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(fs.readFileSync(path.join(root, 'style.css'), 'utf8')), 'hidden items inside Settings must really hide');

// Enterprise quick-start card: the saved goal counts wherever it was chosen (Classic Settings, Home card, Enterprise), and so does having any items.
{
  const i = ent.indexOf('function enterpriseProfile()'), j = ent.indexOf('function applyEnterpriseHomeOrder()', i);
  if (i < 0 || j < 0) throw new Error('Enterprise quick-start card code not found');
  const card = { hidden: null }, box = { childElementCount: 0, innerHTML: '' };
  const e2 = { enterpriseSession: { mode: 'account', ready: true, rootState: {} }, state: { tasks: [], habits: [], notes: [] }, ENTERPRISE_GOALS: { study: { label: 'S' } }, escapeHtml: x => x, Object,
    document: { getElementById: id => id === 'qs-card' ? card : id === 'qs-card-choices' ? box : null } };
  vm.createContext(e2);
  new vm.Script(ent.slice(i, j) + '\nthis.show = renderQuickStartCard;').runInContext(e2);
  e2.show(); assert.strictEqual(card.hidden, false, 'a new empty workspace with no goal is asked');
  e2.enterpriseSession.rootState = { profile: { goal: 'habits' } }; e2.show();
  assert.strictEqual(card.hidden, true, 'a goal chosen in Classic Settings hides the card');
  e2.enterpriseSession.rootState = {}; e2.state.tasks = [{ id: 't' }]; e2.show();
  assert.strictEqual(card.hidden, true, 'a workspace that already has tasks is not asked');
  e2.state.tasks = []; e2.enterpriseSession.rootState = { profile: { goal: '' } }; e2.show();
  assert.strictEqual(card.hidden, true, 'a skipped question is not asked again');
}
console.log('Settings and Home setup card rules passed.');
