const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T = require('../public/chat-tasks.js');

const habits = 'Try these habits:\n- Drink water every morning\n- Walk 20 minutes\n- Read before bed';
const count = (s) => T.extract(s).length;
// what a reply is about
assert.strictEqual(T.classify(habits, 'give me habits', count(habits)), 'habit');
assert.strictEqual(T.classify('Tasks:\n- Finish report due Friday', 'plan', 1), 'task', 'one item is enough');
assert.strictEqual(T.classify('Daily routine and tasks:\n- a thing\n- b thing', '', 2), 'both', 'unclear stays unclear');
assert.strictEqual(T.classify('Daily routine and tasks:\n- a thing\n- b thing', 'give me habits', 2), 'habit', 'your message breaks the tie');
assert.strictEqual(T.classify('Mitochondria\n- one', 'explain', 1), 'none', 'a plain list gets no add button');
// commands
assert.strictEqual(T.resolveIntent('add these', habits).kind, 'habit', 'a habit list is never added as tasks');
assert.strictEqual(T.resolveIntent('add these tasks', habits).kind, 'task', 'what you type wins');
assert.strictEqual(T.resolveIntent('add these', 'Daily routine and tasks:\n- a thing\n- b thing').kind, 'ask', 'unclear means ask, not guess');
assert.strictEqual(T.resolveIntent('add this', 'Do this:\n- One item only').kind, 'task', 'single item');
assert.strictEqual(T.resolveIntent('save this as a note', 'Any reply at all.').kind, 'note');
assert.strictEqual(T.resolveIntent('isse note mein save karo', 'Any reply at all.').kind, 'note');
['create a note about my trip', 'create 3 tasks for my portfolio launch', 'how do I save a note', 'add it for my exam tomorrow'].forEach(s => assert.strictEqual(T.resolveIntent(s, habits), null, 'must go to NexAI: ' + s));
assert.strictEqual(T.resolveIntent('add these', 'No list in this reply.'), null);
const draft = T.noteDraft('## Study plan for exams\nDay 1 revise maths', '2026-11-23');
assert.strictEqual(draft.title, 'Study plan for exams'); assert.deepStrictEqual(draft.tags, ['nexai']);

// wiring in Classic and Enterprise (page + dock share the same helpers)
const classic = read('public/app.js'), ent = read('public/index-redesign.html');
['nexChatAddHabits', 'nexChatAddNote', 'addHabits: nexChatAddHabits', 'addNote: nexChatAddNote'].forEach(k => { assert.ok(classic.includes(k), 'Classic missing ' + k); assert.ok(ent.includes(k), 'Enterprise missing ' + k); });
assert.ok(classic.includes('state.habits.push(habit)') && classic.includes("tags: draft.tags || ['nexai']"), 'Classic habit and note shapes');
assert.ok(ent.includes("color: 'var(--accent-primary)'") && ent.includes('renderAllViews(); };'), 'Enterprise habit and note shapes');
assert.ok(classic.includes("div.querySelector('.msg-bubble')"), 'Classic say() returns the bubble so choice buttons can attach');
console.log('NexOS 3.5.0 chat habits and notes checks passed.');
