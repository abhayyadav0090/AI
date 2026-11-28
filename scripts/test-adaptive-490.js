'use strict';
// NexOS 4.9.0 — PROJECT ADAPTIVE: Personalization, Command Center, Settings & Cross-Viewport Runtime Suite.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');

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
  async waitFor(pred, ms = 9000) {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error(`Timed out waiting for: ${pred}`);
  }
  async screenshot(outPath) {
    if (!outPath) return;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function waitWs(port) {
  const s = Date.now();
  while (Date.now() - s < 9000) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 70));
  }
  throw new Error('Timed out waiting for Chrome DevTools');
}

function runAdaptiveCoreUnitTests() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'adaptive.js'), 'utf8');
  const ctx = { console, Date, Math, JSON, Set, Map, Array, Object, Number, String, Boolean, window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const A = ctx.NexAdaptive;
  assert.ok(A && A.SCHEMA_VERSION === 1, 'NexAdaptive loaded with schema v1');

  // 1. Sanitization drops invalid values and unknown keys cleanly
  const clean = A.sanitizePrefs({
    v: 99,
    profileId: 'study',
    appearance: { interfaceDensity: 'invalid-density', textScale: 999, reducedMotion: 1, highContrast: true, accentPreset: 'bogus' },
    workspace: { widgets: ['notes', 'bogus'], hiddenWidgets: ['habits', 'bad'], widgetSizes: { notes: 'wide', bad: 'huge' }, minimalChrome: 1 },
    navigation: { sidebarMode: 'compact', pinned: ['study', 'bogus'], hidden: ['dashboard', 'analytics'], collapsedGroups: ['growth', 'bad'], mobilePrimary: ['study', 'study', 'focus'] },
    general: { landingView: 'evil-view', startupBehavior: 'last' },
    focusMode: { autoZenOnStart: true },
    updatedAt: 123456,
    injectedProp: 'strip-me',
  });
  assert.equal(clean.v, 1);
  assert.equal(clean.appearance.interfaceDensity, 'comfortable');
  assert.equal(clean.appearance.textScale, 100);
  assert.equal(clean.appearance.reducedMotion, false, 'Non-boolean reducedMotion falls back to preset default');
  assert.equal(clean.appearance.highContrast, true);
  assert.equal(clean.appearance.accentPreset, 'violet', 'Invalid accentPreset falls back to preset default');
  assert.deepEqual([...clean.workspace.widgets], ['notes', 'tasks', 'pomodoro', 'habits']);
  assert.deepEqual([...clean.workspace.hiddenWidgets], ['habits']);
  assert.equal(clean.workspace.widgetSizes.notes, 'wide');
  assert.equal(clean.navigation.hidden.includes('dashboard'), false, 'Dashboard can never be hidden');
  assert.equal(clean.navigation.mobilePrimary.length, 4, 'Mobile bottom nav always padded cleanly to 4 unique slots');
  assert.equal(clean.general.landingView, 'dashboard');
  assert.equal(clean.general.startupBehavior, 'last');
  assert.equal('injectedProp' in clean, false);

  // 2. Preset & widget mutations remain non-destructive and deterministic
  let p = A.applyPreset('deep-work', clean);
  assert.equal(p.profileId, 'deep-work');
  assert.equal(p.navigation.sidebarMode, 'compact');
  assert.deepEqual([...p.workspace.widgets].slice(0, 2), ['pomodoro', 'tasks']);
  p = A.reorderWidgetTo(p, 'notes', 'pomodoro');
  assert.equal(p.profileId, 'custom');
  assert.equal(p.workspace.widgets[0], 'notes');

  // 3. Command Center handles scheduledHour=null safely without phantom 00:00 hits, while indexing valid hours & study docs
  const cmdNullTest = A.queryCommandCenter({
    query: '00:00',
    state: {
      tasks: [
        { id: 't1', title: 'Unscheduled Task', scheduledHour: null, col: 'todo' },
        { id: 't2', title: 'Algorithm Lecture', scheduledHour: 14, col: 'todo' },
      ],
      notes: [],
      habits: [],
    },
    isGuest: false,
    studyDocs: [{ id: 'sd1', title: 'Distributed Systems Notes', subject: 'CS', chunkCount: 8 }],
    actions: [],
    onOpenTask() {},
    onOpenCalendar() {},
    onOpenStudyDoc() {},
  });
  assert.equal(cmdNullTest.some((x) => x.id === 'cal-t1'), false, 'scheduledHour=null must never be indexed as 00:00 calendar block');

  const cmdFull = A.queryCommandCenter({
    query: 'distributed',
    state: { tasks: [], notes: [], habits: [] },
    isGuest: false,
    studyDocs: [{ id: 'sd1', title: 'Distributed Systems Notes', subject: 'CS', chunkCount: 8 }],
    actions: [],
    onOpenStudyDoc() {},
  });
  assert.equal(cmdFull.some((x) => x.id === 'study-sd1'), true, 'Signed-in Command Center indexes study documents');

  const cmdGuest = A.queryCommandCenter({
    query: 'distributed',
    state: { tasks: [], notes: [], habits: [] },
    isGuest: true,
    studyDocs: [{ id: 'sd1', title: 'Distributed Systems Notes', subject: 'CS', chunkCount: 8 }],
    actions: [],
    onOpenStudyDoc() {},
  });
  assert.equal(cmdGuest.some((x) => x.id === 'study-sd1'), false, 'Guest Command Center does not expose authenticated study docs');
  console.log('NexAdaptive core engine unit tests passed.');
}

async function runBackendOwnershipAndSyncTests() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-adaptive-test-secret';
  const app = require('../server.js');
  const userA = '507f1f77bcf86cd799439101';
  const userB = '507f1f77bcf86cd799439102';
  const tokenA = jwt.sign({ id: userA }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ id: userB }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookieA = `token=${tokenA}`;
  const cookieB = `token=${tokenB}`;

  const origReady = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const origUserFind = User.findById;
  const origStateFindOne = UserState.findOne;
  const origStateCreate = UserState.create;
  const origStateUpdate = UserState.findOneAndUpdate;

  const storeByUser = new Map();
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  User.findById = (id) => ({
    select() { return this; },
    async lean() {
      const sid = String(id);
      if (sid === userA) return { _id: userA, name: 'Adaptive A', email: 'a@adaptive.test', picture: '' };
      if (sid === userB) return { _id: userB, name: 'Adaptive B', email: 'b@adaptive.test', picture: '' };
      return null;
    },
  });
  UserState.findOne = (q) => ({
    select() { return this; },
    async lean() { return storeByUser.get(String(q.userId)) || null; },
  });
  UserState.create = async (p) => {
    const doc = { _id: 'st-' + p.userId, userId: String(p.userId), data: p.data, rev: p.rev || 1, updatedAt: new Date() };
    storeByUser.set(String(p.userId), doc);
    return doc;
  };
  UserState.findOneAndUpdate = (f, u) => ({
    select() { return this; },
    async lean() {
      const uid = String(f.userId);
      const cur = storeByUser.get(uid);
      if (cur && f.rev !== undefined && cur.rev !== f.rev) return null;
      const next = { _id: 'st-' + uid, userId: uid, data: u.$set.data, rev: (cur?.rev || 0) + 1, updatedAt: new Date() };
      storeByUser.set(uid, next);
      return next;
    },
  });

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    // 1. User A saves adaptivePrefs -> server sanitizes bad keys & preserves valid fields
    const saveA = await fetch(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        userId: userB, // spoof attempt must be ignored!
        state: {
          tasks: [{ id: 'a1', title: 'User A Task', col: 'todo' }],
          adaptivePrefs: {
            v: 1,
            profileId: 'deep-work',
            appearance: { interfaceDensity: 'spacious', textScale: 120, reducedMotion: true, highContrast: true, accentPreset: 'emerald', evilField: 'drop' },
            workspace: { widgets: ['notes', 'tasks'], hiddenWidgets: ['habits'], widgetSizes: { notes: 'wide' }, minimalChrome: true },
            navigation: { sidebarMode: 'compact', pinned: ['focus', 'study'], hidden: ['dashboard', 'analytics'], collapsedGroups: ['growth'], mobilePrimary: ['focus', 'notes', 'tasks', 'dashboard'] },
            general: { landingView: 'notes', startupBehavior: 'last' },
            focusMode: { autoZenOnStart: true },
            updatedAt: 500000,
            nestedEvil: { foo: 'bar' },
          },
        },
      }),
    });
    assert.equal(saveA.status, 200, 'Authenticated PUT /api/state accepts sanitized adaptivePrefs');

    // 2. User A reads back via /api/bootstrap and verifies sanitized persistence
    const bootA = await fetch(`${base}/api/bootstrap`, { headers: { Cookie: cookieA } }).then((r) => r.json());
    const apA = bootA.state?.adaptivePrefs;
    assert.ok(apA, 'User A /api/bootstrap includes adaptivePrefs');
    assert.equal(apA.profileId, 'deep-work');
    assert.equal(apA.appearance.textScale, 120);
    assert.equal(apA.appearance.interfaceDensity, 'spacious');
    assert.equal(apA.appearance.accentPreset, 'emerald');
    assert.equal('evilField' in apA.appearance, false, 'Unknown fields inside adaptivePrefs stripped by server');
    assert.equal('nestedEvil' in apA, false, 'Top-level unknown adaptivePrefs keys stripped by server');
    assert.equal(apA.navigation.hidden.includes('dashboard'), false, 'Server never lets dashboard be hidden');

    // 3. Mongo operator injection rejected with 400
    const badOp = await fetch(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ state: { adaptivePrefs: { profileId: 'balanced', $where: '1===1' } } }),
    });
    assert.equal(badOp.status, 400, 'Server rejects Mongo $ operator inside adaptivePrefs');

    // 4. User B ownership isolation: User B must NEVER see User A state or adaptivePrefs
    const bootB = await fetch(`${base}/api/bootstrap`, { headers: { Cookie: cookieB } }).then((r) => r.json());
    assert.equal(bootB.user.email, 'b@adaptive.test');
    assert.equal(bootB.state, null, 'User B cannot read User A adaptivePrefs or tasks despite spoofed PUT');

    // User B saves own minimal prefs; User A stays untouched
    await fetch(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ state: { adaptivePrefs: { profileId: 'minimal', updatedAt: 600000 } } }),
    });
    const recheckA = await fetch(`${base}/api/state`, { headers: { Cookie: cookieA } }).then((r) => r.json());
    assert.equal(recheckA.state.adaptivePrefs.profileId, 'deep-work', 'User B writes do not affect User A preferences');
    console.log('Backend adaptivePrefs schema validation & strict user ownership checks passed.');
  } finally {
    if (origReady) Object.defineProperty(mongoose.connection, 'readyState', origReady);
    User.findById = origUserFind;
    UserState.findOne = origStateFindOne;
    UserState.create = origStateCreate;
    UserState.findOneAndUpdate = origStateUpdate;
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
}

async function runBrowserJourneys() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('NexOS 4.9.0 Adaptive browser journeys skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browser = findBrowser();
  if (!browser) {
    console.log('NexOS 4.9.0 Adaptive browser journeys skipped (Chrome/Edge binary not found).');
    return;
  }

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-adaptive-test-secret';
  const app = require('../server.js');
  const shotDir = process.env.NEXOS_SCREENSHOT_DIR || '';
  const snap = async (cdp, name) => {
    if (!shotDir) return;
    await new Promise((r) => setTimeout(r, 380));
    await cdp.screenshot(path.join(shotDir, name + '.png'));
  };

  // Wire isolated in-memory authenticated user + study doc stub for Account & Study Command Center tests
  const userAuth = '507f1f77bcf86cd799439188';
  const tokenAuth = jwt.sign({ id: userAuth }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const origReady = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const Chat = mongoose.models.Chat;
  const PushPreference = mongoose.models.PushPreference;
  const origUserFind = User.findById;
  const origStateFindOne = UserState.findOne;
  const origStateCreate = UserState.create;
  const origStateUpdate = UserState.findOneAndUpdate;
  const origChatFind = Chat.find;
  const origChatFindOne = Chat.findOne;
  const origPushFindOne = PushPreference.findOne;
  let serverAuthDoc = {
    _id: 'st-auth', userId: userAuth, rev: 1, updatedAt: new Date(),
    data: {
      tasks: [
        { id: 'au_t1', title: 'Operating Systems Lab', desc: 'Scheduler simulation', col: 'todo', priority: 'high', due: '2026-12-01', scheduledHour: 14, created: Date.now() },
      ],
      habits: [{ id: 'au_h1', name: 'Algorithms Practice', color: '#8B5CF6', checks: {}, streak: 3 }],
      notes: [{ id: 'au_n1', title: 'Concurrency Lecture Notes', content: 'Mutexes and semaphores', tags: ['os'], pinned: true, created: Date.now() }],
      pomodoroLog: [],
    },
  };
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  User.findById = (id) => ({
    select() { return this; },
    async lean() { return String(id) === userAuth ? { _id: userAuth, name: 'Jordan Lee', email: 'jordan@nexos.test', picture: '' } : null; },
  });
  UserState.findOne = (q) => ({
    select() { return this; },
    async lean() { return String(q.userId) === userAuth ? serverAuthDoc : null; },
  });
  UserState.create = async (p) => { serverAuthDoc = { _id: 'st-auth', userId: String(p.userId), data: p.data, rev: p.rev || 1, updatedAt: new Date() }; return serverAuthDoc; };
  UserState.findOneAndUpdate = (f, u) => ({
    select() { return this; },
    async lean() { serverAuthDoc = { _id: 'st-auth', userId: userAuth, data: u.$set.data, rev: (serverAuthDoc?.rev || 1) + 1, updatedAt: new Date() }; return serverAuthDoc; };
  });
  Chat.find = () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, async lean() { return []; } });
  Chat.findOne = () => ({ select() { return this; }, async lean() { return null; } });
  PushPreference.findOne = () => ({ select() { return this; }, async lean() { return { enabled: true, reminderTime: '09:00' }; } });

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-v490-'));
  const port = 19950 + Math.floor(Math.random() * 600);
  const chrome = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    cdp = new CDPClient(await waitWs(port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ==================== CLASSIC DESKTOP JOURNEYS (GUEST: A, D, F) ====================
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval('startGuest()');
    await cdp.waitFor('document.getElementById("sidebar") !== null');
    await cdp.eval(`(() => {
      if (typeof finishQuickStart === 'function' && document.getElementById('quickstart-modal')?.classList.contains('is-open')) finishQuickStart(true);
      const t = today();
      state.tasks = [{ id: 'cl_t1', title: 'Classic Exam Prep', desc: 'Revise graphs', col: 'todo', priority: 'high', due: t, scheduledHour: 15, created: Date.now() }];
      state.habits = [{ id: 'cl_h1', name: 'Read Textbook', color: '#8B5CF6', checks: {}, streak: 2 }];
      state.notes = [{ id: 'cl_n1', title: 'Graph Theory Summary', content: 'BFS and DFS invariants', tags: ['study'], pinned: true, created: Date.now() }];
      saveState(); renderDashboard(); renderKanban(); renderHabits(); renderNotes(); updateStats();
    })()`);

    const classicA = await cdp.eval(`(() => {
      applyClassicPreset('study');
      toggleClassicWidgetVisibility('habits', true);
      setClassicWidgetSize('notes', 'wide');
      moveClassicWidget('tasks', -1);
      const ap = getClassicAdaptivePrefs();
      return {
        tasksLen: state.tasks.length,
        habitsLen: state.habits.length,
        notesLen: state.notes.length,
        hiddenOk: document.querySelector('#classic-dashboard-widgets [data-widget="habits"]').dataset.widgetHidden === '1',
        sizeOk: document.querySelector('#classic-dashboard-widgets [data-widget="notes"]').dataset.widgetSize === 'wide',
        tasksOrder: ap.workspace.widgets[0],
        accent: document.documentElement.getAttribute('data-accent'),
      };
    })()`);
    assert.equal(classicA.tasksLen, 1);
    assert.equal(classicA.habitsLen, 1);
    assert.equal(classicA.notesLen, 1);
    assert.equal(classicA.hiddenOk, true, 'Classic widget hide applies cleanly');
    assert.equal(classicA.sizeOk, true, 'Classic widget wide size applies cleanly');
    assert.equal(classicA.accent, 'violet', 'Study preset applies violet accent token');
    await snap(cdp, 'classic-desktop-study');

    // Classic reload persistence + Journey D settings + Journey F focus HUD
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && typeof getClassicAdaptivePrefs === "function" && state.tasks.length === 1');
    const classicAfterReload = await cdp.eval(`(() => {
      openProfile('all');
      document.getElementById('classic-settings-search').value = 'contrast';
      filterClassicSettings();
      const hiddenSec = [...document.querySelectorAll('#profile-modal [data-settings-cat]')].filter(s => !s.hidden && getComputedStyle(s).display !== 'none').map(s => s.dataset.settingsCat);
      setClassicSettingsCat('appearance');
      document.getElementById('classic-settings-search').value = '';
      filterClassicSettings();
      updateClassicAppearancePref('textScale', 120);
      updateClassicAppearancePref('highContrast', true);
      updateClassicAppearancePref('reducedMotion', true);
      const scaleAttr = document.documentElement.getAttribute('data-text-scale');
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        tasksSurvived: state.tasks.length === 1 && state.notes.length === 1 && state.habits.length === 1,
        widgetStillHidden: document.querySelector('#classic-dashboard-widgets [data-widget="habits"]').dataset.widgetHidden === '1',
        hiddenSec,
        scaleAttr,
        rootPx,
      };
    })()`);
    assert.equal(classicAfterReload.tasksSurvived, true, 'Classic reload preserves all user records across adaptive changes');
    assert.equal(classicAfterReload.widgetStillHidden, true, 'Classic widget customization persists after reload');
    assert.ok(classicAfterReload.hiddenSec.length > 0 && classicAfterReload.hiddenSec.length <= 2 && classicAfterReload.hiddenSec.some(c => c.includes('accessibility') || c.includes('appearance')), 'Classic Settings search isolates matching section cleanly');
    assert.equal(classicAfterReload.scaleAttr, '120');
    assert.ok(classicAfterReload.rootPx >= 17, `Classic 120% text scale increases root font size (got ${classicAfterReload.rootPx}px)`);
    await snap(cdp, 'classic-desktop-settings');
    await cdp.eval(`(() => {
      document.querySelector('#profile-modal .modal-close')?.click();
      toggleClassicFocusMode(true);
    })()`);
    const classicFocusOn = await cdp.eval(`document.body.classList.contains('nexos-focus-mode') && !document.getElementById('classic-focus-hud').hidden`);
    assert.equal(classicFocusOn, true, 'Classic Focus Mode activates distraction-free HUD');
    await cdp.eval(`toggleClassicFocusMode(false);`);

    // ==================== ENTERPRISE AUTHENTICATED + FULL JOURNEYS (A–F) ====================
    await cdp.send('Network.setCookie', { name: 'token', value: tokenAuth, domain: '127.0.0.1', path: '/', httpOnly: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${base}/api/study/docs*` }] });
    cdp.onFetch = async (p) => {
      if (p.request.url.includes('/api/study/docs')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({
            docs: [{ id: 'sd-auth-1', title: 'Distributed Consensus Algorithms', subject: 'Systems', chunkCount: 6, sourceType: 'pdf' }],
          })).toString('base64'),
        });
        return;
      }
      await cdp.send('Fetch.continueRequest', { requestId: p.requestId });
    };

    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');
    await cdp.waitFor('state.tasks.some(t => t.id === "au_t1")');

    // Journey A (Study Preset -> Widget hide/reorder/size -> save to Mongo mock)
    await cdp.eval(`(async () => {
      applyEnterprisePreset('study');
      toggleEnterpriseWidgetVisibility('habits', true);
      setEnterpriseWidgetSize('pomodoro', 'wide');
      moveEnterpriseWidget('notes', -1);
      await persistEnterpriseWorkspace();
    })()`);
    await cdp.waitFor('document.querySelector(".dashboard-grid [data-widget=\'habits\']")?.dataset.widgetHidden === "1"');
    await snap(cdp, 'ent-desktop-study');

    // Journey E: wipe device localStorage adaptivePrefs -> reload page -> confirm server-side restore from /api/bootstrap!
    await cdp.eval(`(() => {
      Object.keys(localStorage).forEach(k => { if (k.startsWith('nexos_adaptive_') || k.startsWith('nexos_cache_v2_') || k.startsWith('nexus_enterprise_v2')) localStorage.removeItem(k); });
    })()`);
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && enterpriseSession.ready === true');
    const entServerRestored = await cdp.eval(`(() => {
      const ap = getEnterpriseAdaptivePrefs();
      const hb = document.querySelector('.dashboard-grid [data-widget="habits"]');
      const pm = document.querySelector('.dashboard-grid [data-widget="pomodoro"]');
      return {
        profileId: ap.profileId,
        habitsHidden: hb?.dataset.widgetHidden === '1',
        pomoWide: pm?.dataset.widgetSize === 'wide',
        tasksIntact: state.tasks.some(t => t.id === 'au_t1'),
        notesIntact: state.notes.some(n => n.id === 'au_n1'),
        habitsIntact: state.habits.some(h => h.id === 'au_h1'),
      };
    })()`);
    assert.equal(entServerRestored.habitsHidden, true, 'Journey E/A: Hidden widget state restored from server after cache wipe');
    assert.equal(entServerRestored.pomoWide, true, 'Journey E/A: Widget size restored from server');
    assert.equal(entServerRestored.tasksIntact && entServerRestored.notesIntact && entServerRestored.habitsIntact, true, 'Non-destructive preset + layout preserved all workspace items');

    // Journey B (Sidebar Pinning + Compact Sidebar + Keyboard Nav + Mobile Nav Customization)
    await cdp.eval(`(async () => {
      const ap = getEnterpriseAdaptivePrefs();
      commitEnterpriseAdaptivePrefs(NexAdaptive.togglePin(ap, 'analytics'));
      setEnterpriseSidebarMode('compact');
      commitEnterpriseAdaptivePrefs(NexAdaptive.setMobilePrimary(getEnterpriseAdaptivePrefs(), 1, 'calendar'));
      await persistEnterpriseWorkspace();
    })()`);
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && enterpriseSession.ready === true');
    const entJourneyB = await cdp.eval(`(() => {
      const sbRect = document.getElementById('app-sidebar').getBoundingClientRect();
      const isCompact = document.body.classList.contains('sidebar-compact');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', altKey: true, bubbles: true }));
      const switchedToKanban = document.getElementById('pane-kanban').classList.contains('active');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true }));
      return {
        sbWidth: Math.round(sbRect.width),
        isCompact,
        switchedToKanban,
        pinnedHasAnalytics: getEnterpriseAdaptivePrefs().navigation.pinned.includes('analytics'),
        mobTab1: getEnterpriseAdaptivePrefs().navigation.mobilePrimary[1],
      };
    })()`);
    assert.equal(entJourneyB.isCompact, true, 'Journey B: Compact sidebar class persisted on reload');
    assert.ok(entJourneyB.sbWidth <= 90, `Journey B: Compact sidebar collapses width cleanly (got ${entJourneyB.sbWidth}px)`);
    assert.equal(entJourneyB.switchedToKanban, true, 'Journey B: Alt+2 keyboard shortcut switches to Kanban');
    assert.equal(entJourneyB.pinnedHasAnalytics, true, 'Journey B: Pinned destination persisted');
    assert.equal(entJourneyB.mobTab1, 'calendar', 'Journey B: Custom mobile tab 2 persisted');

    // Journey C (Ctrl+K Command Center across Tasks, Notes, Habits, Calendar & Study Material + Quick Action)
    await cdp.eval(`openCommandPalette()`);
    await cdp.waitFor('document.getElementById("modal-command-palette").classList.contains("open")');
    await cdp.waitFor('entStudyDocsCache !== null');
    const entCmdStudy = await cdp.eval(`(() => {
      const inp = document.getElementById('command-palette-input');
      inp.value = 'Distributed Consensus';
      handleCommandPaletteSearch('Distributed Consensus');
      const items = [...document.querySelectorAll('#command-palette-results .command-result-item')].map(el => el.textContent);
      return { count: items.length, text: items.join(' | ') };
    })()`);
    assert.ok(entCmdStudy.text.includes('Distributed Consensus Algorithms') && entCmdStudy.text.includes('Study Material'),
      `Journey C: Command Center finds signed-in Study Materials (got: ${entCmdStudy.text})`);

    const entCmdCalAndAction = await cdp.eval(`(() => {
      handleCommandPaletteSearch('14:00');
      const calTxt = document.getElementById('command-palette-results').textContent;
      handleCommandPaletteSearch('Create New Note');
      const actCount = document.querySelectorAll('#command-palette-results .command-result-item').length;
      return { calHit: calTxt.includes('Operating Systems Lab') && calTxt.includes('Calendar'), actCount };
    })()`);
    assert.equal(entCmdCalAndAction.calHit, true, 'Journey C: Command Center indexes Calendar scheduledHour blocks');
    assert.ok(entCmdCalAndAction.actCount >= 1, 'Journey C: Command Center finds Quick Actions');
    await snap(cdp, 'ent-desktop-command-center');

    // Execute top item via Enter key -> opens Create Note cleanly!
    const entNotesCountBefore = await cdp.eval('state.notes.length');
    await cdp.eval(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    await cdp.waitFor('document.getElementById("pane-notes").classList.contains("active")');
    const entNotesCountAfter = await cdp.eval('state.notes.length');
    assert.equal(entNotesCountAfter, entNotesCountBefore + 1, 'Journey C: Selecting "Create New Note" via keyboard creates note and opens Smart Notes');

    // Journey D (Enterprise 8-category Settings Search, Live CSS Tokens, Confirmed Reset)
    await cdp.eval(`(() => {
      switchNexusView('dashboard');
      openEnterpriseSettingsModal('all');
    })()`);
    await cdp.waitFor('document.getElementById("modal-enterprise-settings").classList.contains("open")');
    await snap(cdp, 'ent-desktop-settings');
    const entSettingsCheck = await cdp.eval(`(async () => {
      const tabs = document.querySelectorAll('#ent-settings-cats .ent-settings-tab').length;
      document.getElementById('ent-settings-search').value = 'contrast';
      filterEnterpriseSettings();
      const filteredCats = [...document.querySelectorAll('#ent-settings-main .ent-settings-sec')].filter(s => !s.hidden).map(s => s.dataset.secCat);
      document.getElementById('ent-settings-search').value = '';
      setEnterpriseSettingsCat('appearance');
      updateEnterpriseAppearancePref('interfaceDensity', 'compact');
      updateEnterpriseAppearancePref('textScale', 110);
      updateEnterpriseAppearancePref('reducedMotion', true);
      updateEnterpriseAppearancePref('highContrast', true);
      const tokensOk = document.documentElement.getAttribute('data-density') === 'compact'
        && document.documentElement.getAttribute('data-text-scale') === '110'
        && document.documentElement.getAttribute('data-reduced-motion') === '1'
        && document.documentElement.getAttribute('data-contrast') === 'high';
      const origConf = window.confirm;
      window.confirm = () => false;
      resetAllEnterprisePreferences();
      const canceledKept110 = document.documentElement.getAttribute('data-text-scale') === '110';
      window.confirm = () => true;
      resetAllEnterprisePreferences();
      window.confirm = origConf;
      const resetBackTo100 = document.documentElement.getAttribute('data-text-scale') === '100';
      closeModal('modal-enterprise-settings');
      await persistEnterpriseWorkspace();
      return { tabs, filteredCats, tokensOk, canceledKept110, resetBackTo100, itemsIntact: state.tasks.some(t => t.id === 'au_t1') };
    })()`);
    assert.equal(entSettingsCheck.tabs, 9, 'Enterprise Settings renders All + 8 categories cleanly');
    assert.deepEqual(entSettingsCheck.filteredCats, ['accessibility'], 'Enterprise Settings search isolates Accessibility');
    assert.equal(entSettingsCheck.tokensOk, true, 'Settings toggles apply real HTML design tokens live');
    assert.equal(entSettingsCheck.canceledKept110, true, 'Canceling Reset Preferences preserves custom settings');
    assert.equal(entSettingsCheck.resetBackTo100, true, 'Confirming Reset Preferences restores defaults cleanly');
    assert.equal(entSettingsCheck.itemsIntact, true, 'Reset Preferences never deletes workspace data');

    // Journey F (Focus Mode HUD via Alt+F -> start timer -> switch views -> Esc exit)
    const entFocusRes = await cdp.eval(`(() => {
      switchNexusView('notes');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', altKey: true, bubbles: true }));
      const entered = document.body.classList.contains('nexos-focus-mode') && !document.getElementById('ent-focus-hud').hidden;
      document.getElementById('ent-focus-hud-play').click();
      const started = state.pomoRunning === true && document.getElementById('ent-focus-hud-play').textContent.includes('Pause');
      const ctxText = document.getElementById('ent-focus-hud-ctx').textContent;
      switchNexusView('dashboard');
      const stillVisibleOnDash = document.body.classList.contains('nexos-focus-mode') && !document.getElementById('ent-focus-hud').hidden;
      return { entered, started, ctxText, stillVisibleOnDash };
    })()`);
    assert.equal(entFocusRes.entered, true, 'Journey F: Alt+F enters Focus Mode HUD');
    assert.equal(entFocusRes.started, true, 'Journey F: Focus HUD Play starts timer');
    assert.ok(entFocusRes.ctxText.length > 0, 'Journey F: Focus HUD displays active context');
    assert.equal(entFocusRes.stillVisibleOnDash, true, 'Journey F: Focus HUD persists across view switches');
    await snap(cdp, 'ent-desktop-focus-hud');

    await cdp.eval(`(() => {
      pausePomodoro(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    const entFocusExited = await cdp.eval(`!document.body.classList.contains('nexos-focus-mode') && document.getElementById('ent-focus-hud').hidden`);
    assert.equal(entFocusExited, true, 'Journey F: Escape exits Focus Mode HUD and restores workspace chrome');

    // ==================== MULTI-VIEWPORT & THEME AUDIT (9 VIEWPORTS) ====================
    for (const theme of ['apple-light', 'apple-dark', 'cobalt-lime-dark', 'violet-orchid-dark', 'cyber-aubergine']) {
      await cdp.eval(`applyNexusTheme('${theme}')`);
    }

    const viewports = [
      [1920, 1080, false, '1920x1080'],
      [1440, 900, false, '1440x900'],
      [1366, 768, false, '1366x768'],
      [1024, 768, false, '1024x768'],
      [768, 1024, false, '768x1024'],
      [430, 932, true, '430x932'],
      [390, 844, true, '390x844'],
      [360, 740, true, '360x740'],
      [320, 700, true, '320x700'],
    ];

    for (const [w, h, mobile, tag] of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
      const check = await cdp.eval(`(() => {
        const res = [];
        for (const v of ['dashboard', 'kanban', 'calendar', 'focus', 'notes', 'ai']) {
          switchNexusView(v);
          const ov = document.documentElement.scrollWidth - window.innerWidth;
          res.push({ v, ov });
        }
        switchNexusView('dashboard');
        const isMob = ${mobile};
        const mobBtns = isMob ? document.querySelectorAll('#mobile-bottom-nav .mob-nav-item').length : 0;
        const smallDashBtns = isMob
          ? [...document.querySelectorAll('#pane-dashboard .ent-dash-adaptive-bar button, #mobile-bottom-nav button')].filter(b => {
            if (b.offsetParent === null) return false;
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32);
          }).map(b => b.textContent.trim() + ':' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height))
          : [];
        openEnterpriseSettingsModal('workspace');
        const dlg = document.querySelector('#modal-enterprise-settings .ent-settings-dialog')?.getBoundingClientRect();
        const dlgFits = !!(dlg && dlg.right <= window.innerWidth + 1 && dlg.bottom <= window.innerHeight + 1);
        return { res, mobBtns, smallDashBtns, dlgFits };
      })()`);
      if (tag === '768x1024' || tag === '390x844' || tag === '320x700') {
        await snap(cdp, `ent-${tag}-settings`);
        await cdp.eval(`closeModal('modal-enterprise-settings')`);
        await snap(cdp, `ent-${tag}-dashboard`);
      } else {
        await cdp.eval(`closeModal('modal-enterprise-settings')`);
      }
      for (const item of check.res) {
        assert.ok(item.ov <= 1, `Enterprise ${tag}/${item.v} zero horizontal overflow (got ${item.ov})`);
      }
      assert.equal(check.dlgFits, true, `Enterprise ${tag} Settings dialog fits inside viewport without clipping`);
      if (mobile) {
        assert.equal(check.mobBtns, 5, `Enterprise ${tag} mobile bottom bar shows 4 primary + 1 More button`);
        assert.deepEqual(check.smallDashBtns, [], `Enterprise ${tag} mobile adaptive & bottom-nav touch targets >= 32px`);
      }
    }

    // Quick Study Studio screenshot check at desktop
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.eval(`openStudyStudio()`);
    await cdp.waitFor('document.body.classList.contains("nexos-study-view-active") || document.documentElement.classList.contains("nexos-study-active")');
    await snap(cdp, 'ent-desktop-study-studio');
    await cdp.eval(`window.NexStudy && NexStudy.close ? NexStudy.close() : switchNexusView('dashboard')`);

    // Classic responsive check (1920, 768, 390, 320)
    await cdp.send('Fetch.disable');
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof openProfile === "function"');
    for (const [w, h, mobile, tag] of [[1920, 1080, false, '1920x1080'], [768, 1024, false, '768x1024'], [390, 844, true, '390x844'], [320, 700, true, '320x700']]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
      const clVp = await cdp.eval(`(() => {
        switchView('dashboard');
        const ovDash = document.documentElement.scrollWidth - window.innerWidth;
        const mobCount = ${mobile} ? document.querySelectorAll('#bottom-nav button').length : 0;
        openProfile('appearance');
        const dlg = document.querySelector('#profile-modal .modal')?.getBoundingClientRect();
        const dlgFits = !!(dlg && dlg.width > 0 && dlg.right <= window.innerWidth + 1 && dlg.bottom <= window.innerHeight + 1);
        return { ovDash, mobCount, dlgFits };
      })()`);
      if (tag === '390x844' || tag === '320x700') {
        await snap(cdp, `classic-${tag}-settings`);
        await cdp.eval(`document.querySelector('#profile-modal .modal-close')?.click()`);
        await snap(cdp, `classic-${tag}-dashboard`);
      } else {
        await cdp.eval(`document.querySelector('#profile-modal .modal-close')?.click()`);
      }
      assert.ok(clVp.ovDash <= 1, `Classic ${tag} zero horizontal overflow (got ${clVp.ovDash})`);
      assert.equal(clVp.dlgFits, true, `Classic ${tag} Settings modal fits cleanly in viewport`);
      if (mobile) assert.equal(clVp.mobCount, 5, `Classic ${tag} mobile bottom bar renders 5 buttons (4 + More)`);
    }

    assert.deepEqual(cdp.errors, [], `Zero browser console/runtime exceptions (got: ${cdp.errors.join('; ')})`);
    assert.deepEqual(cdp.badResponses, [], `Zero unexpected HTTP >=400 responses (got: ${cdp.badResponses.join('; ')})`);
    console.log('NexOS 4.9.0 Project Adaptive browser journeys A-F and 9-viewport audit passed.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (origReady) Object.defineProperty(mongoose.connection, 'readyState', origReady);
    User.findById = origUserFind;
    UserState.findOne = origStateFindOne;
    UserState.create = origStateCreate;
    UserState.findOneAndUpdate = origStateUpdate;
    Chat.find = origChatFind;
    Chat.findOne = origChatFindOne;
    PushPreference.findOne = origPushFindOne;
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
}

(async () => {
  runAdaptiveCoreUnitTests();
  await runBackendOwnershipAndSyncTests();
  await runBrowserJourneys();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
