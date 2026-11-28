'use strict';
// Runtime end-to-end verification suite for NexOS 4.8.0 (HTTP, VM, & Chrome CDP across viewports and themes).
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function findBrowser() {
  for (const p of [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    this.badResponses = [];
    this.allowMocked409 = false;
    this.onFetch = null;
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message || JSON.stringify(m.error)));
        else resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params?.exceptionDetails;
        this.errors.push(d?.exception?.description || d?.text || 'Runtime exception');
      } else if (m.method === 'Network.responseReceived') {
        const resp = m.params?.response;
        if (resp && resp.url && resp.url.startsWith('http://127.0.0.1:') && resp.status >= 400) {
          // 401 is expected when inspecting /api/bootstrap / /api/chats / /api/study/* in guest mode
          const expectedGuest401 = resp.status === 401 && /\/api\/(bootstrap|state|chats|push\/preferences|study\/)/.test(resp.url);
          const expectedConflict = this.allowMocked409 && resp.status === 409 && resp.url.includes('/api/state');
          if (!expectedGuest401 && !expectedConflict) this.badResponses.push(`${resp.status} ${resp.url}`);
        }
      } else if (m.method === 'Fetch.requestPaused' && this.onFetch) {
        this.onFetch(m.params);
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Eval failed');
    }
    return r.result?.value;
  }
  async waitFor(pred, ms = 8000) {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`Timed out waiting for ${pred}`);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function waitWs(port) {
  const s = Date.now();
  while (Date.now() - s < 8000) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('Timed out waiting for Chrome DevTools WS');
}

async function runRecoveryBackupSanitizationUnitTest() {
  const recSrc = fs.readFileSync(path.join(ROOT, 'public', 'recover.html'), 'utf8');
  const scriptMatch = recSrc.match(/<\/main>\s*<script>([\s\S]*?)<\/script>\s*<\/body>/i);
  assert.ok(scriptMatch, 'recover.html main script block parsed');
  const noopEl = {
    hidden: false, textContent: '', className: '', value: '', disabled: false, files: [],
    parentElement: { hidden: false },
    appendChild() {}, append() {}, addEventListener() {}, setAttribute() {}, remove() {}, click() {},
  };
  const winObj = { confirm: () => true, addEventListener() {} };
  const ctx = {
    window: winObj,
    document: { getElementById: () => ({ ...noopEl }), createElement: () => ({ ...noopEl }), addEventListener() {}, body: { appendChild() {} } },
    location: { search: '', origin: 'http://127.0.0.1', pathname: '/recover.html', href: 'http://127.0.0.1/recover.html' },
    parent: { postMessage() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    URLSearchParams, Blob: class {}, FileReader: class {},
    Date, Math, JSON, Set, Map, Array, Object, Number, String, Boolean, Error,
  };
  vm.runInNewContext(scriptMatch[1], ctx);
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(winObj.NexRecover && typeof winObj.NexRecover.validateAndSanitizeBackup === 'function', 'NexRecover exposed at runtime');
  const validated = winObj.NexRecover.validateAndSanitizeBackup(JSON.stringify({
    tasks: [
      { id: 'bk1', title: 'Timeblocked Study', col: 'todo', priority: 'high', due: '2026-12-01', scheduledHour: 14 },
      { id: 'bk2', title: 'Invalid Hour Task', stage: 'inprogress', scheduledHour: 99 },
    ],
    habits: [{ id: 'h1', name: 'Read', checks: { '2026-11-28': true } }],
    notes: [{ id: 'n1', title: 'Plan', content: 'Body', updated: 1700000123456 }],
  }));
  assert.equal(validated.state.tasks[0].scheduledHour, 14, 'Valid scheduledHour preserved by Recovery backup');
  assert.equal(validated.state.tasks[1].col, 'inprogress', 'Enterprise stage normalized to Classic col');
  assert.equal(validated.state.tasks[1].scheduledHour, undefined, 'Out-of-range scheduledHour stripped cleanly');
  assert.equal(validated.state.notes[0].updated, 1700000123456, 'Note updated timestamp preserved by Recovery backup');
}

(async () => {
  await runRecoveryBackupSanitizationUnitTest();

  const browser = findBrowser();
  if (!browser) {
    console.log('NexOS 4.8.0 runtime unit checks passed (Chrome not present in environment).');
    return;
  }

  const app = require(path.join(ROOT, 'server.js'));
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-v480-'));
  const cdpPort = 20200 + Math.floor(Math.random() * 600);
  const chrome = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    cdp = new CDP(await waitWs(cdpPort));
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // -------- 1. RECOVERY CENTER: RUNTIME 409 CONFLICT RETRY & expectedRev --------
    cdp.allowMocked409 = true;
    const recPutBodies = [];
    let recPutAttempts = 0;
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: `${baseUrl}/api/state*` }],
    });
    cdp.onFetch = async (p) => {
      const url = p.request.url;
      if (url.includes('/api/state') && p.request.method === 'GET') {
        const deletedAt = Date.now() - 3600 * 1000;
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({
            rev: 1,
            state: {
              tasks: [],
              habits: [],
              notes: [],
              trash: [{ id: 'tr1', kind: 'task', deletedAt, item: { id: 'rest_t1', title: 'Restored With Conflict', col: 'todo', priority: 'high' } }],
            },
          })).toString('base64'),
        });
        return;
      }
      if (url.includes('/api/state') && p.request.method === 'PUT') {
        recPutAttempts++;
        const payload = JSON.parse(p.request.postData || '{}');
        recPutBodies.push(payload);
        if (recPutAttempts === 1) {
          // Simulate concurrent tab bumping rev to 2 with a concurrent task
          await cdp.send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: 409,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify({
              error: 'Conflict',
              rev: 2,
              state: {
                tasks: [{ id: 'concurrent_t2', title: 'Other Tab Task', col: 'inprogress' }],
                habits: [],
                notes: [],
              },
            })).toString('base64'),
          });
        } else {
          await cdp.send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify({ ok: true, rev: 3 })).toString('base64'),
          });
        }
        return;
      }
      await cdp.send('Fetch.continueRequest', { requestId: p.requestId });
    };

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${baseUrl}/recover.html` });
    await cdp.waitFor('document.querySelectorAll("#trash .restore").length === 1');
    await cdp.eval(`document.querySelector("#trash .restore").click()`);
    await cdp.waitFor('document.querySelector("#trash .restore")?.textContent.includes("Restored")');
    assert.equal(recPutAttempts, 2, 'Recovery restore retries cleanly after 409 conflict');
    assert.equal(recPutBodies[0].expectedRev, 1, 'First PUT sends initial expectedRev 1');
    assert.equal(recPutBodies[1].expectedRev, 2, 'Retry PUT sends server conflict rev 2');
    assert.ok(recPutBodies[1].state.tasks.some((t) => t.id === 'concurrent_t2'), 'Concurrent task preserved across 409 retry');
    assert.ok(recPutBodies[1].state.tasks.some((t) => t.id === 'rest_t1'), 'Restored task merged cleanly after 409 retry');
    cdp.allowMocked409 = false;
    cdp.onFetch = null;
    await cdp.send('Fetch.disable');

    // -------- 2. CLASSIC: ANALYTICS OFFLINE GEOMETRY, KANBAN FILTERS & STUDY STUDIO RUNTIME --------
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval('startGuest()');
    await new Promise((r) => setTimeout(r, 200));
    await cdp.eval(`(() => {
      if (typeof finishQuickStart === 'function' && document.getElementById('quickstart-modal')?.classList.contains('is-open')) finishQuickStart(true);
      closeQuickStart();
      const t = today(), y = dateKey(new Date(Date.now() - 86400000));
      state.tasks = [
        { id: 'v_t1', title: 'Overdue Task', col: 'todo', priority: 'high', due: y, created: Date.now() - 2e5 },
        { id: 'v_t2', title: 'Today Task', col: 'inprogress', priority: 'medium', due: t, created: Date.now() - 1e5 }
      ];
      state.habits = [{ id: 'v_h1', name: 'Read 30m', color: '#0A84FF', checks: { [t]: true }, goal: 7 }];
      state.pomodoroLog = [{ date: t, minutes: 50, taskId: 'v_t2' }, { date: y, minutes: 25 }];
      renderDashboard(); renderKanban(); renderHabits(); updateStats();
    })()`);

    await cdp.eval("switchView('analytics')");
    await new Promise((r) => setTimeout(r, 350));
    const classicAnalyticsCheck = await cdp.eval(`(() => {
      const focusCard = document.querySelector('#view-analytics .analytics-card.wide');
      const cards = Array.from(document.querySelectorAll('#view-analytics .analytics-card'));
      const habitCard = cards[2];
      const focusStat = document.querySelector('#view-analytics #focusChart')?.parentElement?.querySelector('.offline-chart-stat');
      const focusWrap = document.querySelector('#view-analytics #focusChart')?.parentElement;
      const fr = focusCard.getBoundingClientRect();
      const hr = habitCard.getBoundingClientRect();
      const sr = focusStat ? focusStat.getBoundingClientRect() : null;
      const canvasDisplay = document.getElementById('focusChart')?.style.display;

      return {
        wrapOffline: Boolean(focusWrap && focusWrap.classList.contains('is-offline')),
        canvasHidden: canvasDisplay === 'none',
        cardBottom: Math.round(fr.bottom),
        nextRowTop: Math.round(hr.top),
        statBottom: sr ? Math.round(sr.bottom) : 0,
      };
    })()`);
    assert.equal(classicAnalyticsCheck.wrapOffline, true, 'Classic offline chart wrapper gets .is-offline');
    assert.equal(classicAnalyticsCheck.canvasHidden, true, 'Classic offline chart hides <canvas> element');
    assert.ok(classicAnalyticsCheck.statBottom <= classicAnalyticsCheck.cardBottom + 1, 'Offline summary stays inside card border');
    assert.ok(classicAnalyticsCheck.cardBottom <= classicAnalyticsCheck.nextRowTop + 1, 'Focus analytics card never overlaps lower cards');

    // Classic Study Studio runtime: keyboard dropzone activation + final card-again check-in
    const studyRevisionPosts = [];
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: `${baseUrl}/api/study*` }],
    });
    cdp.onFetch = async (p) => {
      const u = p.request.url;
      let body = null;
      if (u.includes('/api/study/docs')) {
        body = { docs: [{ id: '607f1f77bcf86cd799439012', title: 'Sample Notes', subject: 'CS', chunkCount: 3, sourceType: 'txt' }], usage: { docsUsed: 1, docsMax: 20, chunksUsed: 3, chunksMax: 1500 } };
      } else if (u.includes('/api/study/flashcards')) {
        body = { cards: [{ front: 'What is ACID?', back: 'Atomicity, Consistency, Isolation, Durability' }] };
      } else if (u.includes('/api/study/reviews') && p.request.method === 'POST') {
        studyRevisionPosts.push(JSON.parse(p.request.postData || '{}'));
        body = { ok: true };
      } else if (u.includes('/api/study/mindmaps')) {
        body = { mindmaps: [] };
      }
      if (body) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(body)).toString('base64'),
        });
      } else {
        await cdp.send('Fetch.continueRequest', { requestId: p.requestId });
      }
    };

    const studyRuntime = await cdp.eval(`(async () => {
      window.__studyCheckIns = 0;
      NexStudy.open({
        isGuest: () => false,
        signIn: () => {},
        toast: () => {},
        today: () => today(),
        getStudyHabit: () => null,
        ensureStudyHabit: () => ({}),
        recordStudyCheckIn: () => { window.__studyCheckIns++; return {}; },
        addStudyTasks: () => {},
        onOpen: () => {},
        onClose: () => {},
      }, { tab: 'library' });
      await new Promise(r => setTimeout(r, 80));

      // Verify keyboard activation of #ns-drop triggers hidden file input click
      const fileInput = document.getElementById('ns-file');
      let fileInputClicked = false;
      const origClick = fileInput.click;
      fileInput.click = () => { fileInputClicked = true; };
      document.getElementById('ns-drop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fileInput.click = origClick;

      // Switch to Cards tab, generate 1-card deck, flip, click card-again ("Review again") on final card
      document.getElementById('ns-tab-cards').click();
      document.querySelector('[data-ns="make-cards"]').click();
      await new Promise(r => setTimeout(r, 80));
      document.querySelector('[data-ns="flip"]').click();
      document.querySelector('[data-ns="card-again"]').click();
      await new Promise(r => setTimeout(r, 60));
      const cardsDoneText = document.getElementById('ns-cards')?.textContent || '';
      NexStudy.close({ fromNav: true });

      return { fileInputClicked, checkIns: window.__studyCheckIns, cardsDoneText };
    })()`);
    assert.equal(studyRuntime.fileInputClicked, true, 'Pressing Enter on #ns-drop opens file picker');
    assert.equal(studyRuntime.checkIns, 1, 'Finishing final flashcard via Review again triggers recordStudyCheckIn()');
    assert.equal(studyRevisionPosts.length, 1, 'Card marked Review again posts to /api/study/reviews');
    cdp.onFetch = null;
    await cdp.send('Fetch.disable');

    // Classic Mobile + Tablet overflow & touch target checks
    for (const vp of [{ name: 'tablet', w: 768, h: 1024, m: false }, { name: 'mobile', w: 360, h: 740, m: true }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.m });
      const classicVp = await cdp.eval(`(() => {
        switchView('kanban');
        document.getElementById('kanban-search-input').value = '__no_such_task_480__';
        filterClassicKanban();
        const emptyShown = !document.getElementById('classic-kanban-filter-empty').hidden;
        clearClassicKanbanFilters();
        const emptyHiddenAfterReset = document.getElementById('classic-kanban-filter-empty').hidden;
        let maxOverflow = 0;
        for (const v of ['dashboard', 'kanban', 'pomodoro', 'habits', 'notes', 'analytics', 'ai']) {
          switchView(v);
          maxOverflow = Math.max(maxOverflow, document.documentElement.scrollWidth - window.innerWidth);
        }
        switchView('dashboard');
        const dashTiny = Array.from(document.querySelectorAll('#view-dashboard button')).filter(el => {
          if (el.offsetParent === null) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32);
        }).map(el => el.className);

      return { emptyShown, emptyHiddenAfterReset, maxOverflow, dashTiny };
      })()`);
      assert.equal(classicVp.emptyShown, true, `Classic ${vp.name} Kanban shows filter empty banner`);
      assert.equal(classicVp.emptyHiddenAfterReset, true, `Classic ${vp.name} Clear filters restores board`);
      assert.ok(classicVp.maxOverflow <= 0, `Classic ${vp.name} zero horizontal overflow (got ${classicVp.maxOverflow})`);
      if (vp.name === 'mobile') assert.equal(classicVp.dashTiny.length, 0, `Classic mobile dashboard zero tiny targets (${JSON.stringify(classicVp.dashTiny)})`);
    }

    // -------- 3. ENTERPRISE: FOCUS RECONCILIATION, NOTES RACE GUARD, CALENDAR->FOCUS, ALL 5 THEMES --------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${baseUrl}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof switchNexusView === "function"');

    // Mock /api/complete + /api/state inside Enterprise to exercise real aiSummarizeActiveNote async concurrency & stale race guard
    let completeCallIdx = 0;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${baseUrl}/api/complete` }, { urlPattern: `${baseUrl}/api/state*` }] });
    cdp.onFetch = async (p) => {
      if (p.request.url.includes('/api/state')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ ok: true, rev: 2, state: {} })).toString('base64'),
        });
        return;
      }
      completeCallIdx++;
      const idx = completeCallIdx;
      const delayMs = idx === 2 ? 120 : 40; // Call #2 slower than Call #3 to test out-of-order race guard!
      const text = idx === 1 ? 'Live Edit Preserved Summary'
        : idx === 2 ? 'STALE SLOW SUMMARY SHOULD BE IGNORED'
          : 'FRESH FAST SUMMARY WINS';
      setTimeout(async () => {
        try {
          await cdp.send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify({ text })).toString('base64'),
          });
        } catch (_) {}
      }, delayMs);
    };

    const entDesktop = await cdp.eval(`(async () => {
      enterpriseSession.mode = 'account';
      enterpriseSession.user = { name: 'QA Tester', email: 'qa@example.com' };
      enterpriseSession.ready = true;
      const t = today(), y = localDateKey(new Date(Date.now() - 86400000));
      state.pomodoroStats = { totalMins: 0, sessions: 0, streak: 0 };
      state.pomodoroLog = [{ date: t, minutes: 50, taskId: 'et2' }, { date: y, minutes: 25 }];
      state.tasks = [
        { id: 'et1', title: 'Overdue Enterprise Filing', stage: 'todo', priority: 'high', due: y, created: Date.now() - 2e5, scheduledHour: 10 },
        { id: 'et2', title: 'Active Sprint Task', stage: 'inprogress', priority: 'medium', due: t, created: Date.now() - 1e5 }
      ];
      state.habits = [{ id: 'eh1', name: 'Deep Study', color: '#0A84FF', checks: { [t]: true }, goal: 7 }];
      state.notes = [{ id: 'en1', title: 'Architecture Decision Record', content: 'Initial note line', updated: Date.now(), pinned: true }];
      state.currentNoteId = null;
      renderAllViews();

      const kpiFocus = document.getElementById('kpi-focus-val')?.textContent || '';
      const kpiTrend = document.getElementById('kpi-focus-trend')?.textContent || '';
      const ctxFocus = document.getElementById('ctx-focus-badge')?.textContent || '';
      const focusStudioMins = document.getElementById('focus-stat-total-mins')?.textContent || '';
      const focusStudioSess = document.getElementById('focus-stat-sessions')?.textContent || '';
      const sysCtx = enterpriseWorkspaceContext();

      // Bridge reconciliation check
      const rootOut = enterpriseToClassicRoot({});
      const backIn = classicRootToEnterprise({ ...rootOut, enterpriseWorkspace: { pomodoroStats: { totalMins: 0, sessions: 0 } } });

      // Finish one 25m focus sprint in Enterprise and verify pomodoroStats reconciles cleanly (75+25=100, 2+1=3)
      state.pomoMode = 'focus';
      state.pomoTotalTime = 25 * 60;
      finishPomodoroInterval(true);
      const afterFinishTotal = state.pomodoroStats.totalMins;
      const afterFinishSessions = state.pomodoroStats.sessions;

      // Notes auto-selection + Desktop fold
      switchNexusView('notes');
      const loadedNoteTitle = document.getElementById('note-editor-title')?.value || '';
      const notesFooterBottom = Math.round(document.querySelector('#pane-notes .editor-footer-status')?.getBoundingClientRect().bottom || 999);

      // Runtime test 1: concurrent edit while aiSummarizeActiveNote is awaiting network response
      const ta = document.getElementById('note-editor-textarea');
      const sumBtn = document.getElementById('note-ai-summarize-btn');
      const p1 = aiSummarizeActiveNote();
      ta.value += '\\nUser typed mid-request';
      handleNoteContentChange();
      await p1;
      const preservedMidEdit = ta.value.includes('Live Edit Preserved Summary') && ta.value.includes('User typed mid-request');

      // Runtime test 2: stale slower summarize response (#2) must not overwrite faster newer summarize (#3)
      ta.value = 'Fresh base note';
      handleNoteContentChange();
      const pSlow = aiSummarizeActiveNote(); // call #2 (120ms)
      sumBtn.disabled = false;               // simulate concurrent trigger
      const pFast = aiSummarizeActiveNote(); // call #3 (40ms)
      await pFast;
      const disabledDuringFast = false;
      await pSlow;
      const finalRaceNote = ta.value;

      // NexAI Desktop fold
      switchNexusView('ai');
      const aiDockBottom = Math.round(document.querySelector('#pane-ai .ai-input-dock')?.getBoundingClientRect().bottom || 999);

      // Filtered empty Kanban + Calendar quick Focus button
      switchNexusView('kanban');
      filterKanbanSearch('__no_such_ent_task__');
      const entFilterEmptyShown = !document.getElementById('ent-kanban-filter-empty').hidden;
      resetEnterpriseKanbanFilters();

      switchNexusView('calendar');
      const planBtnText = document.querySelector('#pane-calendar .view-actions-cluster .btn-primary')?.textContent.trim() || '';
      const calFocusBtn = document.querySelector('#pane-calendar .calendar-event-pill button[title*="Start focus session"]');
      if (calFocusBtn) calFocusBtn.click();
      const jumpedToFocus = document.getElementById('pane-focus')?.classList.contains('active');


      if (enterpriseSession.saveTimer) clearTimeout(enterpriseSession.saveTimer);
      enterpriseSession.mode = 'preview';
      return {
        kpiFocus, kpiTrend, ctxFocus, focusStudioMins, focusStudioSess,
        sysCtxHas75: sysCtx.includes('"totalMins":75'),
        bridgeTotalMins: backIn.pomodoroStats.totalMins,
        bridgeSessions: backIn.pomodoroStats.sessions,
        afterFinishTotal, afterFinishSessions,
        loadedNoteTitle, notesFooterBottom, aiDockBottom,
        preservedMidEdit, finalRaceNote,
        entFilterEmptyShown, planBtnText, jumpedToFocus,
      };
    })()`);

    cdp.onFetch = null;
    await cdp.send('Fetch.disable');

    assert.equal(entDesktop.kpiFocus, '75m', 'Enterprise KPI Focus reconciles totalMins from pomodoroLog');
    assert.equal(entDesktop.kpiTrend, '50m logged today', 'Enterprise KPI Focus trend shows today minutes');
    assert.equal(entDesktop.ctxFocus, '50m', 'Enterprise NexAI Context Today\'s Focus displays today minutes');
    assert.equal(entDesktop.focusStudioMins, '75 min', 'Focus Studio Total Minutes reconciles from pomodoroLog');
    assert.equal(entDesktop.focusStudioSess, '2', 'Focus Studio Completed Sessions reconciles from pomodoroLog');
    assert.equal(entDesktop.sysCtxHas75, true, 'enterpriseWorkspaceContext passes reconciled totals to NexAI');
    assert.equal(entDesktop.bridgeTotalMins, 75, 'classicRootToEnterprise reconciles pomodoroStats.totalMins');
    assert.equal(entDesktop.bridgeSessions, 2, 'classicRootToEnterprise reconciles pomodoroStats.sessions');
    assert.equal(entDesktop.afterFinishTotal, 100, 'finishPomodoroInterval advances reconciled totalMins cleanly');
    assert.equal(entDesktop.afterFinishSessions, 3, 'finishPomodoroInterval advances reconciled sessions cleanly');
    assert.equal(entDesktop.loadedNoteTitle, 'Architecture Decision Record', 'Smart Notes auto-selects top note when unset');
    assert.ok(entDesktop.notesFooterBottom <= 900, `Enterprise Notes status footer (${entDesktop.notesFooterBottom}) fits inside 900px viewport`);
    assert.ok(entDesktop.aiDockBottom <= 900, `Enterprise NexAI composer dock (${entDesktop.aiDockBottom}) fits inside 900px viewport`);
    assert.equal(entDesktop.preservedMidEdit, true, 'aiSummarizeActiveNote preserves user typing performed while AI summarizes');
    assert.ok(entDesktop.finalRaceNote.includes('FRESH FAST SUMMARY WINS') && !entDesktop.finalRaceNote.includes('STALE SLOW SUMMARY'),
      `Stale slower AI summarize response ignored (got: ${entDesktop.finalRaceNote})`);
    assert.equal(entDesktop.entFilterEmptyShown, true, 'Enterprise Kanban shows Clear filters banner when filtered empty');
    assert.equal(entDesktop.planBtnText, '📅 Plan Day', 'Calendar button uses clean user label');
    assert.equal(entDesktop.jumpedToFocus, true, 'Calendar event pill quick Focus button launches Focus Studio');

    // Tablet (768x1024) & Mobile (360x740) across ALL panes + [hidden] respect check
    for (const vp of [{ name: 'tablet', w: 768, h: 1024, m: false }, { name: 'mobile', w: 360, h: 740, m: true }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.m });
      const vpReport = await cdp.eval(`(() => {
        const res = [];
        for (const pane of ['dashboard', 'kanban', 'calendar', 'focus', 'habits', 'notes', 'analytics', 'ai']) {
          switchNexusView(pane);
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const paneEl = document.getElementById('pane-' + pane);
          const tiny = Array.from(paneEl.querySelectorAll('button, a, input:not([type="checkbox"]), select')).filter(el => {
            if (el.offsetParent === null) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32);
          }).map(el => el.className + ':' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
          const pillOverflow = pane === 'calendar'
            ? Array.from(paneEl.querySelectorAll('.calendar-event-pill')).some(p => p.getBoundingClientRect().right > window.innerWidth + 1)
            : false;
          res.push({ pane, overflow, tinyCount: tiny.length, tiny, pillOverflow });
        }
        // Check a [hidden] .btn-secondary actually stays hidden on mobile!
        const testBtn = document.createElement('button');
        testBtn.className = 'btn-secondary';
        testBtn.hidden = true;
        document.body.appendChild(testBtn);
        const hiddenStillNone = getComputedStyle(testBtn).display === 'none';
        testBtn.remove();

      return { res, hiddenStillNone };
      })()`);
      assert.equal(vpReport.hiddenStillNone, true, `[hidden] .btn-secondary remains display:none on ${vp.name}`);
      for (const item of vpReport.res) {
        assert.ok(item.overflow <= 0, `Enterprise ${vp.name}/${item.pane} zero overflow (got ${item.overflow})`);
        assert.equal(item.pillOverflow, false, `Enterprise ${vp.name}/calendar pills stay inside viewport`);
        if (vp.name === 'mobile') {
          assert.equal(item.tinyCount, 0, `Enterprise mobile/${item.pane} zero sub-32px interactive controls (got ${JSON.stringify(item.tiny)})`);
        }
      }
    }

    const themeReport = await cdp.eval(`(() => {
      const out = [];
      for (const th of ['apple-light', 'apple-dark', 'cyber-aubergine', 'cobalt-lime-dark', 'violet-orchid-dark']) {
        applyNexusTheme(th);
        const s = getComputedStyle(document.body);
        out.push({ th, bg: s.backgroundColor, color: s.color });
      }
      applyNexusTheme('cyber-aubergine');
      return out;
    })()`);
    assert.equal(themeReport.length, 5, 'All 5 Enterprise themes apply cleanly');
    assert.equal(cdp.errors.length, 0, `Zero console/runtime exceptions (got: ${cdp.errors.join('; ')})`);
    assert.equal(cdp.badResponses.length, 0, `Zero unexpected 4xx/5xx responses (got: ${cdp.badResponses.join('; ')})`);

    console.log('NexOS 4.8.0 runtime pre-release QA verification suite passed.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
