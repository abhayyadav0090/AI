#!/usr/bin/env node
'use strict';
// NexOS 4.5.1 — Post-Audit Independent Functional, Cross-Module, Markdown & Security Validation
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');

const habitsLib = require('../public/habits.js');
const planner = require('../lib/study-planner.js');
const study = require('../lib/study.js');
const nexaiReliability = require('../lib/nexai-reliability.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'Missing start marker: ' + startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, 'Missing end marker: ' + endMarker);
  return src.slice(start, end);
}

(async () => {
  const classicJs = read('public/app.js');
  const entHtml = read('public/index-redesign.html');

  // ── 1) Enterprise Functional Workflow: Tasks <-> Calendar <-> Focus <-> Notes <-> Habits <-> Dashboard ──
  {
    const els = new Map();
    const makeEl = (id, init = {}) => {
      const classes = new Set();
      const el = {
        id,
        value: init.value ?? '',
        textContent: init.textContent ?? '',
        innerHTML: '',
        disabled: false,
        title: '',
        className: '',
        classList: {
          add: (...c) => c.forEach((x) => classes.add(x)),
          remove: (...c) => c.forEach((x) => classes.delete(x)),
          contains: (c) => classes.has(c),
          toggle: (c, force) => {
            if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; }
            if (force) classes.add(c); else classes.delete(c);
            return !!force;
          },
        },
        children: [],
        appendChild: (ch) => { el.children.push(ch); return ch; },
        append: (...chs) => el.children.push(...chs),
        select: () => {},
        focus: () => {},
        click: () => {},
        setAttribute: () => {},
        remove: () => {},
      };
      els.set(id, el);
      return el;
    };

    ['kpi-tasks-val', 'kpi-focus-val', 'kpi-habits-val', 'kpi-notes-val', 'ctx-tasks-badge', 'ctx-focus-badge', 'ctx-habits-badge', 'ctx-notes-badge',
     'dash-priorities-list', 'dash-habits-container', 'dash-notes-container', 'dash-ai-insight-text', 'calendar-current-day-label', 'calendar-hourly-grid',
     'notes-list-container', 'note-editor-title', 'note-editor-textarea', 'note-save-status', 'note-word-count-label', 'note-pin-btn', 'note-editor-preview',
     'plan-items-schedule-list', 'tab-pomo-focus', 'tab-pomo-short', 'tab-pomo-long', 'analytics-score-num', 'score-radial-progress', 'analytics-score-milestones',
     'hourly-heat-container'].forEach((id) => makeEl(id));
    makeEl('cfg-focus-min', { value: '999' });
    makeEl('cfg-short-min', { value: '0' });

    const toasts = [];
    let undoCallback = null;
    let promptReply = null;
    let confirmReply = true;
    let nextUid = 1;
    const escapeHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const slices = [
      extractSlice(entHtml, 'function safeEnterpriseStage(value)', 'function enterpriseLocalKey()'),
      extractSlice(entHtml, 'function updateKPICounters()', '// ---------------- KANBAN ----------------'),
      extractSlice(entHtml, 'function setEnterpriseTaskStage(', 'function openNewTaskModal()'),
      extractSlice(entHtml, 'var editingHabitId = null;', '// ---------------- SMART NOTES STUDIO 3.0 ----------------'),
      extractSlice(entHtml, 'let noteSearchQuery =', 'function renderSimpleMarkdown('),
      extractSlice(entHtml, 'function filterNotesSearch(', '// ---------------- ANALYTICS & CHARTS ----------------'),
      extractSlice(entHtml, 'function nexTaskStage(', 'function renderEnterpriseScore()'),
      extractSlice(entHtml, 'let lastProposedSchedule =', '// ---------------- COMMAND PALETTE'),
      extractSlice(entHtml, 'function setPomodoroMode(', 'function renderPomTimerUI()'),
    ].join('\n');

    const ctx = vm.createContext({
      window: { confirm: () => confirmReply, NexHabits: habitsLib },
      document: {
        getElementById: (id) => els.get(id) || null,
        head: { appendChild: () => {} },
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => makeEl('dyn_' + (nextUid++)),
        addEventListener: () => {},
        visibilityState: 'visible',
      },
      prompt: () => promptReply,
      uid: () => 'u_' + (nextUid++),
      today: () => '2026-11-25',
      escapeHtml,
      activeHabits: () => ctx.state.habits.filter((h) => h && !h.archived),
      trashEntry: (kind, item) => 'tr_' + item.id,
      untrash: () => {},
      saveWorkspaceState: () => ctx.updateKPICounters(),
      renderKanban: () => {},
      renderQuickStartCard: () => {},
      applyEnterpriseHomeOrder: () => {},
      nexFocusMinutesMap: () => ({}),
      renderHabits: () => {},
      renderFocusTask: () => {},
      focusLogSession: (mins) => { ctx.state.pomodoroLog.push({ date: '2026-11-25', minutes: mins }); },
      renderPomTimerUI: () => {},
      updatePomoButtonUI: () => {},
      pausePomodoro: () => { ctx.state.pomoRunning = false; },
      playTactileClick: () => {},
      playHarmonicChime: () => {},
      playCompletionConfetti: () => {},
      openModal: () => {},
      closeModal: () => {},
      switchNexusView: () => {},
      renderAllViews: () => { ctx.renderDashboard(); ctx.updateKPICounters(); },
      renderSimpleMarkdown: (s) => '<p>' + escapeHtml(s) + '</p>',
      showToast: (msg, opts) => { toasts.push(msg); undoCallback = opts && opts.onAction ? opts.onAction : null; },
      localDateKey: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
      pomoTimerInterval: null,
      currentViewTitle: 'Dashboard',
      enterpriseSession: { mode: 'account' },
      clearTimeout,
      setTimeout,
      habitDetailId: null,
      state: {
        tasks: [],
        habits: [],
        notes: [],
        pomodoroLog: [],
        pomodoroStats: { sessions: 0, totalMins: 0 },
        pomoMode: 'focus',
        pomoRunning: false,
        pomoTotalTime: 1500,
        pomoTimeRemaining: 1500,
        currentNoteId: null,
      },
    });
    ctx.window.addEventListener = () => {};
    vm.runInContext(slices, ctx);

    // 1a) Tasks + Calendar + KPI sync
    promptReply = '   Write architecture audit report   ';
    ctx.scheduleTaskAtHour(15);
    assert.equal(ctx.state.tasks.length, 1);
    assert.equal(ctx.state.tasks[0].scheduledHour, 15);
    assert.equal(els.get('kpi-tasks-val').textContent, 1);

    // Move task to Done via drop + toggle back
    const tId = ctx.state.tasks[0].id;
    ctx.toggleTaskDone(tId);
    assert.equal(ctx.state.tasks[0].stage, 'done');
    assert.ok(Number.isFinite(ctx.state.tasks[0].doneAt));
    assert.equal(els.get('kpi-tasks-val').textContent, 0);
    ctx.toggleTaskDone(tId);
    assert.equal(ctx.state.tasks[0].stage, 'todo');
    assert.equal(ctx.state.tasks[0].doneAt, undefined);
    assert.equal(els.get('kpi-tasks-val').textContent, 1);

    // Bridge preserves scheduledHour across Classic <-> Enterprise
    const classicTask = ctx.mapEnterpriseTaskToClassic(ctx.state.tasks[0]);
    assert.equal(classicTask.col, 'todo');
    assert.equal(classicTask.scheduledHour, 15);
    const backEnt = ctx.mapClassicTaskToEnterprise(classicTask);
    assert.equal(backEnt.scheduledHour, 15);

    // 1b) Focus timer clamping + skip vs completion
    ctx.setPomodoroMode('focus');
    assert.equal(els.get('cfg-focus-min').value, 120, 'focus min clamped to 120');
    assert.equal(ctx.state.pomoTotalTime, 120 * 60);
    ctx.skipPomodoro();
    assert.equal(ctx.state.pomodoroStats.sessions, 0, 'skip leaves sessions untouched');
    assert.equal(ctx.state.pomodoroLog.length, 0, 'skip leaves pomodoroLog empty');

    ctx.setPomodoroMode('short');
    assert.equal(els.get('cfg-short-min').value, 1, 'short break clamped to 1');
    ctx.state.pomoMode = 'focus';
    ctx.state.pomoTotalTime = 25 * 60;
    ctx.completePomodoroInterval();
    assert.equal(ctx.state.pomodoroStats.sessions, 1);
    assert.equal(ctx.state.pomodoroStats.totalMins, 25);
    assert.equal(els.get('kpi-focus-val').textContent, '25m');

    // 1c) Habits check-in, false-key deletion, reject whitespace, delete + Undo KPI sync
    promptReply = '   ';
    ctx.openNewHabitModal();
    assert.equal(ctx.state.habits.length, 0, 'rejects blank habit name');

    promptReply = 'Deep Study Daily';
    ctx.openNewHabitModal();
    assert.equal(ctx.state.habits.length, 1);
    const hId = ctx.state.habits[0].id;
    ctx.toggleHabitCheck(hId, '2026-11-25');
    assert.equal(ctx.state.habits[0].checks['2026-11-25'], true);
    assert.equal(els.get('kpi-habits-val').textContent, '100%');
    ctx.toggleHabitCheck(hId, '2026-11-25');
    assert.equal('2026-11-25' in ctx.state.habits[0].checks, false, 'unchecked key deleted cleanly');
    assert.equal(els.get('kpi-habits-val').textContent, '0%');

    ctx.deleteHabit(hId);
    assert.equal(ctx.state.habits.length, 0);
    assert.ok(typeof undoCallback === 'function', 'deleteHabit provides Undo callback');
    undoCallback();
    assert.equal(ctx.state.habits.length, 1, 'Undo restores deleted habit');

    // 1d) Smart Notes: unsaved preservation across search filter + switch flush + Pin + Delete/Undo
    ctx.quickCreateNote();
    const note1Id = ctx.state.currentNoteId;
    els.get('note-editor-title').value = 'Architecture Draft';
    els.get('note-editor-textarea').value = 'Unsaved critical note body!';
    ctx.markNoteUnsaved();
    // Searching notes must NOT clobber unsaved edits in editor
    ctx.filterNotesSearch('nomatchquery');
    assert.equal(els.get('note-editor-textarea').value, 'Unsaved critical note body!', 'searching must not overwrite unsaved editor content');
    ctx.filterNotesSearch('');

    // Creating or opening another note must flush previous edits automatically
    ctx.quickCreateNote();
    const note2Id = ctx.state.currentNoteId;
    assert.equal(ctx.state.notes.find((n) => n.id === note1Id).content, 'Unsaved critical note body!', 'switching/creating note auto-flushes dirty note');
    ctx.openNoteInEditor(note1Id);
    ctx.togglePinActiveNote();
    assert.equal(ctx.state.notes.find((n) => n.id === note1Id).pinned, true);
    ctx.deleteActiveNote();
    assert.equal(ctx.state.notes.length, 1);
    undoCallback();
    assert.equal(ctx.state.notes.length, 2, 'Undo restores deleted note');

    // 1e) Analytics score cross-check against stored data
    const score = ctx.nexProductivityScore(ctx.state, '2026-11-25');
    // 0 done of 1 task (0), 25m focus (25/120 * 30 = 6.25), 0 of 1 habit (0) -> rounds to 6
    assert.equal(score, 6, 'Productivity score matches actual stored state');
  }

  // ── 2) Live Express HTTP Server Validation: Study Auth, IDOR Isolation, Saved studyTime/timeZone, Input Guards ──
  {
    let seq = 1;
    const oid = () => String(seq++).padStart(24, '0');
    const makeStore = () => {
      const rows = [];
      const eq = (a, b) => String(a ?? '') === String(b ?? '');
      const match = (r, f) => Object.entries(f || {}).every(([k, v]) => eq(r[k], v));
      class Q {
        constructor(list) { this.list = list; }
        select() { return this; }
        sort() { return this; }
        limit(n) { this.list = this.list.slice(0, n); return this; }
        lean() { return this; }
        then(res, rej) { return Promise.resolve(this.list.map((x) => ({ ...x }))).then(res, rej); }
      }
      return {
        rows,
        find: (f) => new Q(rows.filter((r) => match(r, f))),
        findOne: (f) => {
          const found = rows.find((r) => match(r, f));
          const obj = found ? Object.assign(found, { save: async () => found }) : null;
          const q = new Q(obj ? [obj] : []);
          q.then = (res, rej) => Promise.resolve(obj).then(res, rej);
          return q;
        },
        countDocuments: async (f) => rows.filter((r) => match(r, f)).length,
        create: async (d) => { const r = { ...d, _id: oid(), createdAt: new Date(), updatedAt: new Date() }; rows.push(r); return r; },
        deleteOne: async (f) => { const i = rows.findIndex((r) => match(r, f)); if (i >= 0) { rows.splice(i, 1); return { deletedCount: 1 }; } return { deletedCount: 0 }; },
      };
    };

    const secret = 'validation-only-secret-key';
    const userA = 'a'.repeat(24);
    const userB = 'b'.repeat(24);
    const tokA = jwt.sign({ uid: userA }, secret, { expiresIn: '1h' });
    const tokB = jwt.sign({ uid: userB }, secret, { expiresIn: '1h' });
    const requireAuth = (req, res, next) => {
      const auth = String(req.get('authorization') || '');
      if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
      try { req.userId = jwt.verify(auth.slice(7), secret).uid; next(); }
      catch (_) { return res.status(401).json({ error: 'Invalid token' }); }
    };

    const Review = makeStore();
    const Plan = makeStore();
    const PushPref = makeStore();
    const app = express();
    app.use(express.json());
    app.use('/api/study', planner.createRouter({
      mongoose: { model: () => makeStore(), isValidObjectId: (id) => /^[0-9a-f]{24}$/i.test(String(id)) },
      StudyReview: Review,
      StudyExamPlan: Plan,
      PushPreference: PushPref,
      requireAuth,
      isValidId: (id) => /^[0-9a-f]{24}$/i.test(String(id)),
    }));
    const srv = http.createServer(app);
    await new Promise((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${srv.address().port}/api/study`;

    try {
      // Unauthenticated request fails 401
      const unauth = await fetch(base + '/plans');
      assert.equal(unauth.status, 401, 'Rejects unauthenticated study request');

      // User A creates plan with custom studyTime and timeZone
      const future = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      const createRes = await fetch(base + '/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokA}` },
        body: JSON.stringify({ title: 'Physics Finals', examDate: future, dailyMinutes: 75, studyTime: '20:15', timeZone: 'America/New_York', topics: ['Kinematics', 'Electromagnetism'] }),
      }).then((r) => r.json());
      assert.ok(createRes.id);

      // Default schedule & calendar.ics WITHOUT explicit query params must honor saved plan.studyTime and plan.timeZone!
      const sched = await fetch(base + `/plans/${createRes.id}/schedule`, {
        headers: { Authorization: `Bearer ${tokA}` },
      }).then((r) => r.json());
      assert.equal(sched.startTime, '20:15', 'GET /schedule honors saved plan.studyTime');
      assert.equal(sched.timeZone, 'America/New_York', 'GET /schedule honors saved plan.timeZone');
      assert.equal(sched.blocks[0].startTime, '20:15');

      const ics = await fetch(base + `/plans/${createRes.id}/calendar.ics`, {
        headers: { Authorization: `Bearer ${tokA}` },
      }).then((r) => r.text());
      assert.ok(ics.includes('TZID=America/New_York:') && ics.includes('T201500'), 'GET /calendar.ics honors saved plan.studyTime and timeZone');

      // User B cannot view, toggle topic, schedule, download .ics, or delete User A's plan
      assert.equal((await fetch(base + `/plans/${createRes.id}/schedule`, { headers: { Authorization: `Bearer ${tokB}` } })).status, 404);
      assert.equal((await fetch(base + `/plans/${createRes.id}/calendar.ics`, { headers: { Authorization: `Bearer ${tokB}` } })).status, 404);
      assert.equal((await fetch(base + `/plans/${createRes.id}/topics/0`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokB}` } })).status, 404);
      assert.equal((await fetch(base + `/plans/${createRes.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokB}` } })).status, 404);
      assert.equal(Plan.rows.length, 1, 'User A plan remains intact after User B IDOR attempts');

      // User A completes topic 0 -> next schedule excludes completed topic
      await fetch(base + `/plans/${createRes.id}/topics/0`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` } });
      const schedAfter = await fetch(base + `/plans/${createRes.id}/schedule`, { headers: { Authorization: `Bearer ${tokA}` } }).then((r) => r.json());
      assert.ok(!schedAfter.blocks.some((b) => b.topics.includes('Kinematics')), 'Completed topic excluded from upcoming blocks');
    } finally {
      await new Promise((r) => srv.close(r));
    }
  }

  // ── 3) Exact NexAI Phase-3 Four Prompt Formatting Validation (Classic + Enterprise) ──
  {
    const cStart = classicJs.indexOf('function formatChat(text) {');
    const cEnd = classicJs.indexOf('\nfunction appendChatMsg', cStart);
    const escHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cVm = { escHtml };
    vm.runInNewContext(classicJs.slice(cStart, cEnd), cVm);

    const eStart = entHtml.indexOf('function renderSimpleMarkdown(md) {');
    const eEnd = entHtml.indexOf('\n}\n', eStart) + 2;
    const escapeHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const eVm = { escapeHtml };
    vm.runInNewContext(entHtml.slice(eStart, eEnd), eVm);

    const promptsAndResponses = [
      // Prompt 1: hello 3 things, anything
      'Hello!\n\n1. Drink a glass of water.\n2. Take a 2-minute stretch break.\n3. Pick your top priority today.',
      // Prompt 2: Explain LinkedIn in detail using three numbered sections with explanatory paragraphs between them.
      '1. **Job Search & Internships**\n\nRecruiters use LinkedIn filters to discover candidates.\n\n2. **Content Sharing & Learning**\n\nSharing concise project takeaways builds trust over time.\n\n3. **Upskilling & Knowledge**\n\nFollow engineers and researchers for curated domain insights.',
      // Prompt 3: Explain a topic using nested numbered and bulleted lists.
      '1. **Core Concepts**\n  - Input validation\n    1. Trim whitespace\n    2. Enforce bounds\n2. **Verification**\n  - Unit checks\n  - End-to-end runs',
    ];

    for (const md of promptsAndResponses) {
      const h1 = cVm.formatChat(md);
      const h2 = eVm.renderSimpleMarkdown(md);
      assert.equal(h1, h2, 'Classic and Enterprise render identical HTML for prompt cases');
      assert.ok((h1.match(/<ol\b/g) || []).length >= 1, 'Rendered HTML contains ordered list');
      assert.equal((h1.match(/<\/ol><p><strong>/g) || []).length, 0, 'Ordered list does not split across subsequent bold items');
    }

    // Prompt 4: Give me a detailed answer and continue if you reach the response limit (multi-part MAX_TOKENS continuation + rendering)
    let turn = 0;
    const continued = await nexaiReliability.streamWithAutoContinuation({
      askStream: async ({ onText, timings }) => {
        turn++;
        if (turn === 1) {
          const p1 = '1. **Phase One**\n\nInitial explanation of the system.\n\n2. **Phase Two**\n\nPreparing next step';
          onText(p1); timings.finishReason = 'MAX_TOKENS'; return p1;
        }
        const p2 = 'Preparing next step cleanly.\n\n3. **Phase Three**\n\nFinal verification step.';
        onText(p2); timings.finishReason = 'STOP'; return p2;
      },
      system: 'sys',
      contents: [{ role: 'user', parts: [{ text: 'Give me a detailed answer and continue if you reach the response limit.' }] }],
      onText() {},
      timings: {},
    });
    assert.equal(continued.incomplete, false);
    const ch = cVm.formatChat(continued.text);
    const eh = eVm.renderSimpleMarkdown(continued.text);
    assert.equal((ch.match(/<ol\b/g) || []).length, 1, 'Classic: continued response keeps all 3 sections in ONE <ol>');
    assert.equal((eh.match(/<ol\b/g) || []).length, 1, 'Enterprise: continued response keeps all 3 sections in ONE <ol>');

    // 4) Markdown GFM tables, blockquotes, XSS safety in cells, and non-table pipe prose fallthrough
    const tableMd = [
      '| Module | Status |',
      '|---|---|',
      '| **Study Studio** | Ready |',
      '| `<script>x</script>` | Safe |',
      '',
      '> Quoted insight line one',
      '> Quoted insight line two',
      '',
      'Use A | B as plain text.',
    ].join('\n');
    const th1 = cVm.formatChat(tableMd);
    const th2 = eVm.renderSimpleMarkdown(tableMd);
    assert.equal(th1, th2, 'Classic and Enterprise render identical HTML for tables and blockquotes');
    assert.ok(th1.includes('<div class="chat-table-wrap"><table class="chat-table"><thead><tr><th>Module</th><th>Status</th></tr></thead><tbody><tr><td><strong>Study Studio</strong></td><td>Ready</td></tr><tr><td><code>&lt;script&gt;x&lt;/script&gt;</code></td><td>Safe</td></tr></tbody></table></div>'));
    assert.ok(th1.includes('<blockquote>Quoted insight line one<br>Quoted insight line two</blockquote>'));
    assert.ok(th1.includes('<p>Use A | B as plain text.</p>'));
    assert.ok(!th1.includes('<script>'));

    // 5) Performance check on large Markdown payload (400 lines with nested lists and tables)
    const bigMd = Array.from({ length: 40 }, (_, i) => `${i + 1}. **Section ${i + 1}**\n\nDetails for item ${i + 1}.\n  - Sub A\n  - Sub B\n\n| K | V |\n|---|---|\n| a | ${i} |`).join('\n\n');
    const t0 = performance.now();
    const bigC = cVm.formatChat(bigMd);
    const bigE = eVm.renderSimpleMarkdown(bigMd);
    const renderMs = performance.now() - t0;
    assert.ok(bigC.length > 2000 && bigE.length > 2000);
    assert.ok(renderMs < 150, `Large Markdown render took ${renderMs.toFixed(1)}ms (must be < 150ms)`);
  }

  // ── 6) Live Main Express App Boot Smoke Test (Health, CSP Headers, Static Routes, 401 Boundaries) ──
  {
    const mainApp = require('../server.js');
    const liveSrv = http.createServer(mainApp);
    await new Promise((r) => liveSrv.listen(0, '127.0.0.1', r));
    const urlBase = `http://127.0.0.1:${liveSrv.address().port}`;
    try {
      const hRes = await fetch(urlBase + '/api/health');
      assert.equal(hRes.status, 200);
      const hJson = await hRes.json();
      assert.equal(hJson.status, 'ok');
      assert.equal(hJson.version, '4.6.0');

      for (const p of ['/', '/enterprise', '/style.css', '/app.js', '/study.js', '/recover.html']) {
        const r = await fetch(urlBase + p);
        assert.equal(r.status, 200, `Expected 200 for ${p}`);
      }
      const rootRes = await fetch(urlBase + '/');
      assert.ok(rootRes.headers.get('content-security-policy'), 'Helmet CSP header present');

      for (const protectedPath of ['/api/state', '/api/chats', '/api/study/docs', '/api/study/plans']) {
        const r = await fetch(urlBase + protectedPath);
        assert.equal(r.status, 401, `${protectedPath} rejects unauthenticated requests`);
      }
    } finally {
      await new Promise((r) => liveSrv.close(r));
    }
  }

  // ── 7) Reliability Invariants: Unload Flushes, Calendar Pin Preservation, Graceful Shutdown ──
  {
    const srvCode = read('server.js');
    assert.ok(classicJs.includes('flushPendingStateOnExit') && classicJs.includes("addEventListener('pagehide', flushPendingStateOnExit)"), 'Classic flushes pending cloud state on pagehide');
    assert.ok(entHtml.includes('flushEnterpriseStateOnExit') && entHtml.includes('keepalive: putBody.length < 60000'), 'Enterprise flushes pending cloud state on pagehide with keepalive');
    assert.ok(entHtml.includes('pinnedHours.has(curHour)'), 'Enterprise Calendar auto-schedule preserves manually pinned hours');
    assert.ok(srvCode.includes("process.on('SIGTERM'") && srvCode.includes('gracefulShutdown'), 'Server registers SIGTERM/SIGINT graceful shutdown');
  }

  console.log('NexOS 4.5.1 post-audit independent validation passed.');
})().catch((err) => { console.error(err); process.exit(1); });
