const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const classic = read('public/index.html'), ent = read('public/index-redesign.html');

// Classic: Study Studio sidebar entry with the book icon, before NexAI
const nav = classic.slice(classic.indexOf('class="sidebar-nav"'));
assert.ok(nav.includes('id="nav-study"') && nav.includes('openStudyStudio()') && nav.includes('href="#i-book"'), 'Classic sidebar has Study Studio with the book icon');
assert.ok(nav.indexOf('id="nav-study"') < nav.indexOf('data-view="ai"') && nav.indexOf('data-view="analytics"') < nav.indexOf('id="nav-study"'), 'Study Studio sits between Insights and NexAI');

// Enterprise: sidebar order top to bottom matches Alt+1..9
const side = ent.slice(ent.indexOf('aria-label="Workspace views"'), ent.indexOf('</nav>', ent.indexOf('aria-label="Workspace views"')));
const items = [...side.matchAll(/<button class="nav-btn[^>]*?(?:data-view="(\w+)"|id="(nav-study)")[\s\S]*?data-key="(\d)">Alt\+\d/g)].map((m) => [m[1] || 'study', m[3]]);
assert.deepStrictEqual(items, [['dashboard', '1'], ['kanban', '2'], ['focus', '3'], ['habits', '4'], ['notes', '5'], ['analytics', '6'], ['calendar', '7'], ['study', '8'], ['ai', '9']], 'sidebar order and Alt labels agree');

// keyboard map matches the labels, and Alt+8 opens the dialog instead of a view
const map = /const VIEW_KEYS = \{([^}]*)\}/.exec(ent)[1];
const keys = Object.fromEntries([...map.matchAll(/Digit(\d): '(\w+)'/g)].map((m) => [m[1], m[2]]));
assert.deepStrictEqual(keys, { 1: 'dashboard', 2: 'kanban', 3: 'focus', 4: 'habits', 5: 'notes', 6: 'analytics', 7: 'calendar', 8: 'study', 9: 'ai' });
assert.ok(ent.includes("if (VIEW_KEYS[e.code] === 'study') openStudyStudio(); else switchNexusView(VIEW_KEYS[e.code]);"));
assert.ok(read('README.md').includes('`Alt+8` Study Studio'));
assert.ok(read('public/recover.html').length > 1000);
console.log('NexOS 4.1.2 sidebar and shortcut order checks passed.');
