'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('server.js');
const classic = read('public/app.js');
const classicHtml = read('public/index.html');
const enterprise = read('public/index-redesign.html');
const ui = read('public/ui.js');
const sw = read('public/sw.js');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

assert.strictEqual(pkg.version, '3.0.0', 'package version must be 3.0.0');
assert.strictEqual(lock.version, '3.0.0', 'lockfile version must be 3.0.0');
assert.ok(server.includes("'/bootstrap'"), 'bootstrap must pass through the database connection middleware');
assert.ok(server.includes("app.get('/api/bootstrap', requireAuth"), 'authenticated bootstrap endpoint must exist');
assert.ok(server.includes("res.setHeader('Cache-Control', 'private, no-store')"), 'personalized bootstrap data must not be cached');
assert.ok(server.includes(".select('data').lean()"), 'workspace reads should use lean, projected queries');
assert.ok(server.includes('stale-while-revalidate=300'), 'HTML should have a short stale-while-revalidate cache policy');
assert.ok(server.includes('max-age=31536000, immutable'), 'versioned assets should be immutable cached');

assert.ok(classic.includes("fetch('/api/bootstrap'"), 'Classic should use the combined bootstrap endpoint');
assert.ok(classic.includes('async function loadState(bootstrapPayload = null)'), 'Classic state loader should accept the bootstrap payload');
assert.ok(classic.includes('ensureClassicChartLibrary'), 'Classic charts should be lazy-loaded');
assert.ok(!classicHtml.includes('chart.umd.min.js'), 'Classic should not eagerly load Chart.js in the HTML');
assert.ok(classicHtml.includes('app.js?v=3.0.0') && classicHtml.includes('ui.js?v=3.0.0'), 'Classic application scripts should be versioned');

const loadStart = enterprise.indexOf('async function loadWorkspaceState()');
const loadEnd = enterprise.indexOf('function scheduleEnterpriseCloudSave(', loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'Enterprise workspace loader should be present');
const loadBlock = enterprise.slice(loadStart, loadEnd);
assert.ok(loadBlock.includes("fetch('/api/bootstrap'"), 'Enterprise should use the combined bootstrap endpoint');
assert.ok(!loadBlock.includes("fetch('/api/me'"), 'Enterprise startup must not serially fetch /api/me');
assert.ok(!loadBlock.includes("fetch('/api/state'"), 'Enterprise startup must not serially fetch /api/state');
assert.ok(enterprise.includes('Promise.allSettled([loadEnterpriseChatHistory(), loadEnterpriseReminderPreferences()])'), 'independent Enterprise startup requests should run concurrently');
assert.ok(enterprise.includes('ensureEnterpriseChartLibrary'), 'Enterprise charts should be lazy-loaded');
assert.ok(enterprise.includes('playCompletionConfetti'), 'Enterprise confetti should load on demand');
assert.ok(!enterprise.includes('if (window.confetti) confetti()'), 'Pomodoro completion must use the on-demand confetti loader');
assert.ok(!enterprise.includes('chart.umd.min.js</script>'), 'Enterprise should not eagerly load Chart.js');
assert.ok(!enterprise.includes('confetti.browser.min.js</script>'), 'Enterprise should not eagerly load confetti');
assert.ok(!enterprise.includes("document.addEventListener('mousemove'"), 'unused document-wide mouse spotlight should be removed');
assert.ok(enterprise.includes('setInterval(update, 15000)'), 'Enterprise clock should not run every second');
assert.ok(enterprise.includes("document.querySelectorAll('.modal-overlay-backdrop').forEach"), 'Enterprise dialog observer should be scoped to dialog roots');
assert.ok(ui.includes("document.querySelectorAll('.modal-overlay').forEach"), 'Classic dialog observer should be scoped to dialog roots');
assert.ok(sw.includes("const CACHE = 'nexos-shell-v4'"), 'service worker cache namespace should be bumped');

console.log('NexOS 3.0.0 performance and startup checks passed.');
