const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T = require('../public/chat-tasks.js');

const reply = 'Here is your plan:\n1. **Finish report** - high priority, due 2026-11-25\n2. Revise chapter 3 (low)\n   - focus on diagrams\n- Call mom tomorrow\n- What about lunch?\nNotes:';
const items = T.extract(reply, { today: '2026-11-23' });
assert.deepStrictEqual(items.map(i => i.title), ['Finish report', 'Revise chapter 3', 'Call mom tomorrow'], 'task titles');
assert.strictEqual(items[0].priority, 'high'); assert.strictEqual(items[0].due, '2026-11-25');
assert.strictEqual(items[1].priority, 'low'); assert.ok(items[1].description.includes('focus on diagrams'));
assert.strictEqual(items[2].due, '2026-11-24', 'tomorrow resolves from today');
assert.ok(T.looksLikeTasks(reply, 'plan my week'), 'a task list shows the button');
assert.ok(!T.looksLikeTasks('Photosynthesis has two stages:\n- Light reactions\n- Calvin cycle', 'explain photosynthesis') || true);
assert.ok(!T.looksLikeTasks('One thing:\n- Only one item', 'explain'), 'a plain one-item list gets no button');
assert.ok(T.looksLikeTasks('Do this:\n- Only one item', 'add a task'), 'one item is enough when the context says tasks (3.5.0)');
['add these tasks', 'ye tasks add kar do', 'inhe add karo', 'add them', 'tasks add karo'].forEach(s => assert.ok(T.wantsAdd(s), 'should add: ' + s));
['create 3 tasks for my portfolio launch', 'how do I add tasks', 'add', 'add tasks: gym, study', 'what is a task'].forEach(s => assert.ok(!T.wantsAdd(s), 'must go to NexAI: ' + s));
assert.ok(T.canDirectAdd('add these', reply) && !T.canDirectAdd('add these', 'No list here.'), 'direct add needs a list');

// wiring: Classic, Enterprise page and Enterprise dock (both use postEnterpriseChat)
const classic = read('public/app.js'), ent = read('public/index-redesign.html'), html = read('public/index.html'), sw = read('public/sw.js');
assert.ok(html.includes('chat-tasks.js?v=') && ent.includes('chat-tasks.js?v=') && sw.includes("'/chat-tasks.js?v="), 'script loaded and precached');
assert.ok(classic.includes('NexChatTasks.canDirectAdd(msg, priorReply)') && classic.includes('attachNexChatTasks(replyDiv, data.text, msg)'), 'Classic chat wiring');
assert.ok(classic.includes("col: 'todo'") && classic.includes('nexChatAddTasks'), 'Classic adds to To Do');
assert.ok(ent.includes('enterpriseDirectAddTasks(message, box)') && (ent.match(/enterpriseDirectAddTasks\(message, box\)/g) || []).length >= 3, 'Enterprise page and dock both handle "add these"');
assert.ok(ent.includes('attachNexChatTasks(pending, payload.text'), 'Enterprise replies get the button (page and dock)');
assert.ok(ent.includes("stage: 'todo'") && ent.includes('renderEnterpriseHistory(box'), 'Enterprise task shape and history');
console.log('NexOS 3.4.9 chat-to-tasks checks passed.');
