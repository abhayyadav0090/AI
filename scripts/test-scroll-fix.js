const fs = require('fs');
const classic = fs.readFileSync('public/app.js', 'utf8');
const enterprise = fs.readFileSync('public/index-redesign.html', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');
const checks = [
  [classic.includes("previousView !== 'view-' + name") && classic.includes('window.scrollTo({ top: 0, left: 0, behavior: \'instant\' })'), 'Classic view navigation resets scroll'],
  [classic.includes(".modal-overlay.is-open") && classic.includes('new MutationObserver(sync)'), 'Classic modal scroll lock observes modal state'],
  [enterprise.includes("previousPane !== 'pane-' + name") && enterprise.includes('window.scrollTo({ top: 0, left: 0, behavior: \'instant\' })'), 'Enterprise view navigation resets scroll'],
  [enterprise.includes('function syncEnterpriseModalScroll()') && enterprise.includes('window.scrollTo(lock.x, lock.y)'), 'Enterprise modal scroll lock restores position'],
  [css.includes('overscroll-behavior: contain') && css.includes('-webkit-overflow-scrolling: touch'), 'Classic modal scroll is contained']
];
for (const [ok, label] of checks) { if (!ok) { console.error('FAIL:', label); process.exitCode = 1; } else console.log('PASS:', label); }
