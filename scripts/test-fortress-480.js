'use strict';
// NexOS 4.8.0 — PROJECT FORTRESS: Backend Security, Workflows A–F, Edge Cases, 250-Item Perf, A11y & 7-Viewport Suite.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const planner = require('../lib/study-planner');
const study = require('../lib/study');
const nexaiReliability = require('../lib/nexai-reliability');

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => fs.existsSync(p));
}

function parseRgb(str) {
  const m = String(str || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) } : null;
}

function contrastRatio(fgStr, bgStr) {
  const fg = parseRgb(fgStr);
  const bg = parseRgb(bgStr);
  if (!fg || !bg) return 0;
  const lum = ({ r, g, b }) => {
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    this.badResponses = [];
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
        this.errors.push(d?.exception?.description || d?.text || 'Uncaught exception');
      } else if (m.method === 'Console.messageAdded' && m.params?.message?.level === 'error') {
        const txt = m.params.message.text || '';
        if (!/status of 401|Failed to load resource: net::ERR|accounts\.google\.com|fonts\.googleapis|cdn\.jsdelivr\.net/i.test(txt)) {
          this.errors.push(txt);
        }
      } else if (m.method === 'Network.responseReceived') {
        const resp = m.params?.response;
        if (resp && resp.url && resp.url.startsWith('http://127.0.0.1:') && resp.status >= 400) {
          const expectedGuest401 = resp.status === 401 && /\/api\/(bootstrap|state|chats|push\/preferences|study\/)/.test(resp.url);
          if (!expectedGuest401) this.badResponses.push(`${resp.status} ${resp.url}`);
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
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error(`Timed out waiting for: ${pred}`);
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
  throw new Error('Timed out waiting for Chrome DevTools');
}

async function runBackendHardeningTests() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-fortress-secret';
  const app = require('../server.js');
  const userA = '507f1f77bcf86cd799439011';
  const userB = '507f1f77bcf86cd799439022';
  const tokenA = jwt.sign({ id: userA }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookieA = `token=${tokenA}`;

  // Backup originals
  const origReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const Chat = mongoose.models.Chat;
  const origFindById = User.findById;
  const origStateFindOne = UserState.findOne;
  const origStateCreate = UserState.create;
  const origStateUpdate = UserState.findOneAndUpdate;
  const origChatFindOne = Chat.findOne;

  let storedData = null;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  User.findById = (id) => ({
    select() { return this; },
    async lean() { return String(id) === userA ? { _id: userA, name: 'Fortress A', email: 'a@nexos.test', picture: '' } : null; },
  });
  UserState.findOne = () => ({ select() { return this; }, async lean() { return storedData; } });
  UserState.create = async (p) => { storedData = { _id: 'st-1', userId: p.userId, data: p.data, rev: p.rev || 1, updatedAt: new Date() }; return storedData; };
  UserState.findOneAndUpdate = (_f, u) => ({
    select() { return this; },
    async lean() { storedData = { _id: 'st-1', userId: userA, data: u.$set.data, rev: (storedData?.rev || 1) + 1, updatedAt: new Date() }; return storedData; },
  });
  Chat.findOne = () => ({ select() { return this; }, async lean() { return null; } });

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    // 1. PUT /api/state prototype pollution & Mongo $ operator rejection
    const protoPayload = '{"__proto__":{"pollutedProp":true},"constructor":{"prototype":{"hacked":1}},"tasks":[{"id":"t1","title":"Safe"}]}';
    const protoRes = await fetch(base + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: `{"state":${protoPayload}}`,
    });
    assert.equal(protoRes.status, 200, 'Sanitizes __proto__/constructor while preserving valid keys');
    assert.equal(({}).pollutedProp, undefined, 'Object.prototype must never be polluted');
    assert.equal(Object.prototype.hasOwnProperty.call(storedData.data, 'constructor'), false, 'constructor key stripped');

    const dollarRes = await fetch(base + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ state: { tasks: [{ $where: '1 === 1' }] } }),
    });
    assert.equal(dollarRes.status, 400, 'Rejects Mongo operator $ key inside state with 400');

    let deep = { ok: true };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    const deepRes = await fetch(base + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ state: deep }),
    });
    assert.equal(deepRes.status, 400, 'Rejects excessively nested state objects (>24 levels) with 400');

    // 2. Non-24-hex 12-char ObjectId lookalike rejected cleanly before Mongo cast errors
    const badChat = await fetch(base + '/api/chats/twelvechars!', { headers: { Cookie: cookieA } });
    assert.equal(badChat.status, 404, 'GET /api/chats/:id rejects non-24-hex id cleanly');
    const badChatPost = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ chatId: 'twelvechars!', message: 'hello world test' }),
    });
    assert.equal(badChatPost.status, 400, 'POST /api/chat rejects non-24-hex chatId with 400');

    // 3. Whitespace-only /api/complete prompt rejected with 400
    const blankComplete = await fetch(base + '/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ prompt: '   \n\t  ' }),
    });
    assert.equal(blankComplete.status, 400, 'POST /api/complete rejects whitespace-only prompt');

    // 4. Year-end & leap-day timezone rollover safety in study planner + cross-user plan isolation
    const leapDue = planner.computeNextDueAt(new Date('2024-02-28T18:00:00.000Z'), 1, 'UTC');
    assert.equal(planner.zonedDateKey(leapDue, 'UTC'), '2024-02-29', 'Leap-day boundary handled accurately');
    const yearEnd = planner.addDaysToKey('2026-12-31', 1);
    assert.equal(yearEnd, '2027-01-01', 'Year-end rollover handled cleanly');

    // Study planner router: user B cannot access or rate user A's review
    const ReviewStore = {
      rows: [{ _id: '507f1f77bcf86cd799439099', userId: userA, topic: 'OS', intervalDays: 1, repetitions: 0, save: async () => {} }],
      findOne: (f) => ({
        select() { return this; },
        then(res, rej) {
          const hit = ReviewStore.rows.find((r) => String(r._id) === String(f._id) && String(r.userId) === String(f.userId)) || null;
          return Promise.resolve(hit).then(res, rej);
        },
      }),
    };
    const subApp = express();
    subApp.use(express.json());
    subApp.use('/api/study', planner.createRouter({
      mongoose: { model: () => ({}) },
      StudyReview: ReviewStore,
      StudyExamPlan: {},
      requireAuth: (req, _res, next) => { req.userId = userB; next(); },
      isValidId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)),
    }));
    const pSrv = http.createServer(subApp);
    await new Promise((r) => pSrv.listen(0, '127.0.0.1', r));
    try {
      const rateB = await fetch(`http://127.0.0.1:${pSrv.address().port}/api/study/reviews/507f1f77bcf86cd799439099/rate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 'good' }),
      });
      assert.equal(rateB.status, 404, 'User B cannot rate User A review');
    } finally {
      pSrv.closeAllConnections?.();
      await new Promise((r) => pSrv.close(r));
    }

    // 5. Partial/empty AI SSE continuation fallback
    const emptyRes = await nexaiReliability.askWithAutoContinuation({
      askOnce: async () => ({ text: '', finishReason: 'STOP' }),
      system: '', contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.ok(emptyRes.text.length > 0 && emptyRes.incomplete === false, 'Empty STOP reply returns safe non-empty fallback');
  } finally {
    if (origReadyState) Object.defineProperty(mongoose.connection, 'readyState', origReadyState);
    User.findById = origFindById;
    UserState.findOne = origStateFindOne;
    UserState.create = origStateCreate;
    UserState.findOneAndUpdate = origStateUpdate;
    Chat.findOne = origChatFindOne;
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
}

async function runBrowserFortressSuite() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('NexOS 4.8.0 Fortress browser suite skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('NexOS 4.8.0 Fortress browser suite skipped (Chrome/Edge binary not found).');
    return;
  }

  const app = require('../server.js');
  const httpServer = http.createServer(app);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-fortress-'));
  const port = 19740 + Math.floor(Math.random() * 800);
  const chrome = spawn(browserPath, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    cdp = new CDPClient(await waitWs(port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ── A. Workflows A, C, D, F, Quota safety & Modal A11y on CLASSIC ──
    await cdp.send('Page.navigate', { url: base + '/' });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval(`startGuest();`);
    await cdp.waitFor('document.querySelector("#dash-tasks-list") !== null');
    await cdp.eval(`if (typeof finishQuickStart === 'function') finishQuickStart(true); document.querySelectorAll('.modal-overlay.is-open').forEach(el => el.classList.remove('is-open'));`);

    const classicRes = await cdp.eval(`(async () => {
      // Empty validation sets aria-invalid
      document.getElementById('new-task-input').value = '   ';
      addTask();
      const emptyTaskInvalid = document.getElementById('new-task-input').getAttribute('aria-invalid') === 'true';

      // Workflow A: Create task -> start focus -> complete session -> Dashboard/Analytics consistent
      const hugeTitle = 'Long Fortress Task ' + 'X'.repeat(400);
      document.getElementById('new-task-input').value = hugeTitle;
      addTask();
      const added = state.tasks.find(t => t.title.startsWith('Long Fortress Task'));
      const cappedLen = added ? added.title.length : 0;
      focusOnTask(added.id);
      pomState.mode = 'focus';
      pomDurations.focus = 25;
      pomState.endAt = Date.now() - 1000;
      pomSessionComplete();
      const focusLogsAfter = state.pomodoroLog.filter(l => l.taskId === added.id).length;

      // Workflow C prep: Add habit and toggle today check
      document.getElementById('new-habit-input').value = 'Fortress Daily Review';
      addHabit();
      const hab = state.habits.find(h => h.name === 'Fortress Daily Review');
      toggleHabit(hab.id, today());

      // Action Mode modal A11y (NexUI.observeModal)
      openNexAIActionMode();
      await new Promise(r => setTimeout(r, 60));
      const actionModalFocusedInside = document.getElementById('nexos-action-modal')?.contains(document.activeElement);
      closeNexAIActionMode();

      // QuotaExceededError safety: mock localStorage.setItem throwing QuotaExceededError during cacheState()
      const origSet = Storage.prototype.setItem;
      let quotaThrew = false;
      Storage.prototype.setItem = function () { const e = new DOMException('Quota exceeded', 'QuotaExceededError'); throw e; };
      try { cacheState(); } catch (_) { quotaThrew = true; } finally { Storage.prototype.setItem = origSet; }

      // Malformed backup rejection in importData() preserves existing state and shows error toast
      const origConfirm = window.confirm;
      window.confirm = () => true;
      const tasksBeforeBadImport = state.tasks.length;
      await importData({ target: { files: [new File(['{bad json'], 'bad.json', { type: 'application/json' })], value: '' } });
      const rejectMalformedPreservedState = state.tasks.length === tasksBeforeBadImport && [...document.querySelectorAll('#toasts .toast-text')].some(el => /valid NexOS JSON backup/i.test(el.textContent));
      // __proto__ stripping during importData
      await importData({ target: { files: [new File([JSON.stringify({ app: 'NexOS', state: JSON.parse('{"tasks":[{"id":"imp1","title":"Imported Fortress"}],"habits":[],"notes":[],"__proto__":{"evil":true}}') })], 'clean.json', { type: 'application/json' })], value: '' } });
      const protoPolluted = ({}).evil === true;
      window.confirm = origConfirm;
      const rejectMalformed = rejectMalformedPreservedState;
      // Re-add Workflow C habit after import test so reload persistence can verify it cleanly
      document.getElementById('new-habit-input').value = 'Fortress Persisted Habit';
      addHabit();
      const persistedHab = state.habits.find(h => h.name === 'Fortress Persisted Habit');
      toggleHabit(persistedHab.id, today());
      saveState();

      // Classic Multi-Theme Contrast Check (google-light, google-dark, apple-light, apple-dark)
      const contrastOk = [];
      for (const d of ['google', 'apple']) {
        for (const t of ['light', 'dark']) {
          NexUI.setDesign(d); NexUI.setTheme(t);
          const bs = getComputedStyle(document.body);
          const stat = getComputedStyle(document.getElementById('stat-tasks-val'));
          const card = getComputedStyle(document.querySelector('.stat-card'));
          contrastOk.push({ d, t, txt: stat.color, bg: card.backgroundColor, bodyBg: bs.backgroundColor });
        }
      }
      NexUI.setDesign('google'); NexUI.setTheme('dark');

      return { emptyTaskInvalid, cappedLen, focusLogsAfter, actionModalFocusedInside, quotaThrew, rejectMalformed, protoPolluted, contrastOk };
    })()`);

    assert.equal(classicRes.emptyTaskInvalid, true, 'Classic empty task submission marks input aria-invalid=true');
    assert.equal(classicRes.cappedLen, 160, 'Classic caps extreme 400+ char task titles to 160');
    assert.equal(classicRes.focusLogsAfter, 1, 'Workflow A: Focus session completes and logs linked to task');
    assert.equal(classicRes.actionModalFocusedInside, true, 'Classic NexAI Action Mode modal receives keyboard focus via NexUI.observeModal');
    assert.equal(classicRes.quotaThrew, false, 'Classic QuotaExceededError on localStorage handled without exception');
    assert.equal(classicRes.rejectMalformed, true, 'Classic backup import handles malformed JSON cleanly');
    assert.equal(classicRes.protoPolluted, false, 'Classic backup import strips __proto__ cleanly');
    for (const c of classicRes.contrastOk) {
      const ratio = contrastRatio(c.txt, c.bodyBg);
      assert.ok(ratio >= 4.5, `Classic ${c.d}/${c.t} stat contrast against body (${ratio.toFixed(2)}) must be >= 4.5:1`);
    }

    // Workflow C reload verification
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && typeof state !== "undefined" && state.habits.some(h => h.name === "Fortress Persisted Habit")');
    const habPersisted = await cdp.eval(`(() => {
      const h = state.habits.find(x => x.name === 'Fortress Persisted Habit');
      return !!(h && h.checks && h.checks[today()]);
    })()`);
    assert.equal(habPersisted, true, 'Workflow C: Habit check-in survives full browser reload');

    // ── B. Enterprise: Modal Focus/Tab-Trap/Escape, 250-Item Performance Scale, Workflows A/E, 7 Viewports ──
    await cdp.send('Page.navigate', { url: base + '/enterprise' });
    await cdp.waitFor('document.readyState === "complete" && typeof switchNexusView === "function" && typeof openModal === "function"');

    // Seed 250 tasks, 30 habits, 120 notes, 200 focus logs cleanly in Enterprise Guest state
    await cdp.eval(`(async () => {
      const cols = ['todo', 'inprogress', 'review', 'done'];
      const pris = ['low', 'medium', 'high'];
      const td = today();
      const big = {
        tasks: Array.from({ length: 250 }, (_, i) => ({
          id: 'f_t_' + i, title: 'Scale Task ' + i + (i === 0 ? ' #critical' : ''), desc: 'Scale desc ' + i,
          col: cols[i % 4], priority: pris[i % 3], due: i % 5 === 0 ? td : '',
          scheduledHour: i < 2 ? (9 + i) : null, created: Date.now() - i * 1000
        })),
        habits: Array.from({ length: 30 }, (_, i) => ({
          id: 'f_h_' + i, name: 'Scale Habit ' + i, color: '#0A84FF', goal: 5, checks: { [td]: i % 2 === 0 }, streak: 1
        })),
        notes: Array.from({ length: 120 }, (_, i) => ({
          id: 'f_n_' + i, title: 'Scale Note ' + i, content: 'Body line '.repeat(20), pinned: i < 2, tags: ['scale'], created: Date.now() - i * 1000, updated: Date.now() - i * 1000
        })),
        pomodoroLog: Array.from({ length: 200 }, (_, i) => ({ date: td, minutes: 25 })),
        pomodoroStats: { totalToday: 200 * 25, sessionsToday: 200, longestStreak: 10, lastDate: td },
        profile: { goal: 'projects' }, seeded: true, hideGuide: true
      };
      localStorage.setItem('nexos_guest_mode_v1', '1');
      localStorage.setItem('nexos_guest_state_v1', JSON.stringify(big));
    })()`);
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && typeof state !== "undefined" && state.tasks.length === 250');

    const entCheck = await cdp.eval(`(async () => {
      // Scale Perf on 250 tasks / 120 notes / 30 habits / 200 logs
      const tK0 = performance.now();
      switchNexusView('kanban');
      renderKanban();
      const kanbanRenderMs = +(performance.now() - tK0).toFixed(2);

      const tF0 = performance.now();
      filterKanbanSearch('#critical');
      const filterMs = +(performance.now() - tF0).toFixed(2);
      const filteredCards = document.querySelectorAll('#pane-kanban .task-card').length;
      resetEnterpriseKanbanFilters();

      const domBefore = document.getElementsByTagName('*').length;
      const tLoop0 = performance.now();
      for (let i = 0; i < 8; i++) { switchNexusView('kanban'); switchNexusView('calendar'); switchNexusView('notes'); switchNexusView('dashboard'); }
      const loop32Ms = +(performance.now() - tLoop0).toFixed(2);
      const domAfter = document.getElementsByTagName('*').length;

      // Empty validation sets aria-invalid
      openNewHabitModal();
      document.getElementById('new-habit-modal-name').value = '   ';
      submitNewHabitModal();
      const emptyHabitInvalid = document.getElementById('new-habit-modal-name').getAttribute('aria-invalid') === 'true';
      closeModal('modal-new-habit');

      // Enterprise Modal A11y: focus moves inside, Tab wraps, Escape closes + unlocks body scroll + restores focus!
      switchNexusView('kanban');
      const triggerBtn = document.createElement('button');
      triggerBtn.type = 'button';
      triggerBtn.id = 'fortress-modal-trigger';
      triggerBtn.textContent = 'Trigger';
      document.body.appendChild(triggerBtn);
      triggerBtn.focus();
      openNewTaskModal();
      const openedInside = document.getElementById('modal-task-editor').contains(document.activeElement);
      const modalBtns = [...document.getElementById('modal-task-editor').querySelectorAll('button')].filter(b => b.offsetWidth > 0 && !b.disabled);
      const lastModalBtn = modalBtns[modalBtns.length - 1];
      let tabWrappedInside = false;
      if (lastModalBtn) {
        lastModalBtn.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        tabWrappedInside = document.getElementById('modal-task-editor').contains(document.activeElement) && document.activeElement !== lastModalBtn;
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const modalClosedAfterEsc = !document.getElementById('modal-task-editor').classList.contains('open');
      const bodyScrollUnlocked = document.body.style.position === '';
      const focusRestored = document.activeElement === triggerBtn;
      triggerBtn.remove();

      // QuotaExceededError safety in Guest save
      const origSet = Storage.prototype.setItem;
      let entQuotaThrew = false;
      Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
      try { await persistEnterpriseWorkspace(); } catch (_) { entQuotaThrew = true; } finally { Storage.prototype.setItem = origSet; }

      // Check zero unlabeled visible interactive buttons
      const unlabeledButtons = [...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const txt = (b.textContent || '').trim();
        const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
        return !txt && !aria;
      }).map(b => b.outerHTML.slice(0, 80));

      return {
        kanbanRenderMs, filterMs, filteredCards, loop32Ms, domBefore, domAfter,
        emptyHabitInvalid, openedInside, tabWrappedInside, modalClosedAfterEsc, bodyScrollUnlocked, focusRestored, entQuotaThrew, unlabeledButtons
      };
    })()`);

    assert.ok(entCheck.kanbanRenderMs < 250, `Enterprise 250-task Kanban switch+render (${entCheck.kanbanRenderMs}ms) must be < 250ms`);
    assert.ok(entCheck.filterMs < 50, `Enterprise 250-task search filter (${entCheck.filterMs}ms) must be < 50ms`);
    assert.equal(entCheck.filteredCards, 1, '250-task search accurately filters #critical');
    assert.equal(entCheck.domAfter, entCheck.domBefore, 'Repeated view switching causes zero DOM node leaks');
    assert.equal(entCheck.emptyHabitInvalid, true, 'Enterprise empty habit modal marks input aria-invalid=true');
    assert.equal(entCheck.openedInside, true, 'Enterprise modal places focus inside dialog on open');
    assert.equal(entCheck.tabWrappedInside, true, 'Tab at end of Enterprise modal wraps focus inside dialog');
    assert.equal(entCheck.modalClosedAfterEsc, true, 'Escape closes Enterprise modal');
    assert.equal(entCheck.bodyScrollUnlocked, true, 'Escape unlocks body position=fixed scroll lock');
    assert.equal(entCheck.focusRestored, true, 'Escape restores focus back to modal opener');
    assert.equal(entCheck.entQuotaThrew, false, 'Enterprise Guest QuotaExceededError handled gracefully');
    assert.deepEqual(entCheck.unlabeledButtons, [], 'All visible buttons have accessible names');

    // All 7 viewports (Desktop -> 320px Mobile) overflow + Calendar row overlap guard
    await cdp.eval(`
      state.tasks = state.tasks.slice(0, 4);
      state.tasks[0].scheduledHour = 9;
      state.tasks[0].title = 'Overdue exam prep long wrapping task title';
      renderAllViews();
      renderCalendarTimeline();
    `);
    for (const [w, h, m] of [
      [1920, 1080, false], [1440, 900, false], [1366, 768, false], [768, 1024, false],
      [390, 844, true], [360, 740, true], [320, 700, true],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m });
      const vpRes = await cdp.eval(`(() => {
        switchNexusView('calendar');
        const ovCal = document.documentElement.scrollWidth - window.innerWidth;
        const rows = [...document.querySelectorAll('#calendar-hourly-grid .calendar-hour-row')].map(r => r.getBoundingClientRect());
        let overlap = false;
        for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) overlap = true;
        for (const p of document.querySelectorAll('#calendar-hourly-grid .calendar-event-pill')) {
          const pr = p.getBoundingClientRect();
          const rr = p.closest('.calendar-hour-row')?.getBoundingClientRect();
          if (rr && (pr.top < rr.top - 1 || pr.bottom > rr.bottom + 1)) overlap = true;
        }
        switchNexusView('dashboard');
        const ovDash = document.documentElement.scrollWidth - window.innerWidth;
        return { ovCal, ovDash, overlap };
      })()`);
      assert.ok(vpRes.ovCal <= 1 && vpRes.ovDash <= 1, `Enterprise ${w}x${h} zero horizontal overflow (cal=${vpRes.ovCal}, dash=${vpRes.ovDash})`);
      assert.equal(vpRes.overlap, false, `Enterprise ${w}x${h} Calendar rows and pills must not overlap vertically`);
    }

    assert.deepEqual(cdp.errors, [], `Zero runtime/console errors during Fortress suite (got: ${cdp.errors.join('; ')})`);
    assert.deepEqual(cdp.badResponses, [], `Zero unexpected HTTP errors during Fortress suite`);
    console.log(`NexOS 4.8.0 Project Fortress suite passed (250-task Kanban=${entCheck.kanbanRenderMs}ms, filter=${entCheck.filterMs}ms).`);
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    httpServer.closeAllConnections?.();
    await new Promise((r) => httpServer.close(r));
  }
}

(async () => {
  await runBackendHardeningTests();
  await runBrowserFortressSuite();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
