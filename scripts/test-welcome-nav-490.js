'use strict';
// NexOS 4.9.0 — Project Welcome & Navigation Refinement Verification Suite
// Covers: Two-Group Enterprise Sidebar, Legacy Migration, First-Time Welcome,
// Existing-User Protection, 6-Step Guided Tour, Contextual Hints, Light/Dark Themes, 9 Viewports, Classic Parity.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
require(path.join(PUB, 'adaptive.js'));
const NexAdaptive = globalThis.NexAdaptive;

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async waitFor(pred, ms = 9000) {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error(`Timeout waiting for: ${pred}`);
  }
  async screenshot(dir, name) {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, name), Buffer.from(res.data, 'base64'));
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
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('Timeout waiting for Chrome DevTools');
}

function runUnitAndMigrationChecks() {
  // 1. Two-group Enterprise sidebar schema & legacy migration
  assert.deepEqual(NexAdaptive.GROUP_IDS, ['workspace', 'productivity'], 'Enterprise sidebar must expose exactly 2 primary groups');
  assert.deepEqual(NexAdaptive.migrateCollapsedGroups(['growth', 'knowledge', 'bogus']), ['productivity'], 'Legacy growth maps to productivity; obsolete knowledge/bogus dropped');
  const migrated = NexAdaptive.sanitizePrefs({
    navigation: {
      collapsedGroups: ['growth', 'knowledge', 'workspace'],
      order: ['study', 'dashboard', 'notes', 'kanban'],
    },
  });
  assert.deepEqual(migrated.navigation.collapsedGroups, ['workspace', 'productivity'], 'sanitizePrefs migrates collapsedGroups cleanly');
  assert.deepEqual(NexAdaptive.PRESETS.minimal.collapsedGroups, ['productivity'], 'Minimal preset collapses productivity group cleanly');

  // 2. Existing-user protection & first-time eligibility rules
  const basePrefs = NexAdaptive.buildDefaults('balanced');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs }), true, 'Brand-new empty workspace should receive Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs, hasTasks: true }), false, 'Workspace with existing tasks must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs, hasHabits: true }), false, 'Workspace with existing habits must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs, hasNotes: true }), false, 'Workspace with existing notes must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs, seeded: true }), false, 'Already seeded account must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: basePrefs, hasGoals: true }), false, 'Account with existing goal must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: { ...basePrefs, onboarding: { welcomeCompleted: true } } }), false, 'Completed onboarding must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: { ...basePrefs, onboarding: { welcomeSkippedAt: 12345 } } }), false, 'Skipped onboarding must NOT auto-show Welcome');
  assert.equal(NexAdaptive.shouldOfferWelcome({ prefs: { ...basePrefs, updatedAt: 1000 } }), false, 'User with customized adaptivePrefs must NOT auto-show Welcome');

  // 3. Visual reset preserves onboarding completion & dismissed hints
  const customized = {
    ...NexAdaptive.applyPreset('study', basePrefs),
    onboarding: {
      welcomeCompleted: true,
      welcomeSkippedAt: 99999,
      tourCompleted: true,
      tourSkippedAt: 0,
      dismissedHints: ['pin-nav', 'cmd-center'],
      neverShowHints: true,
    },
  };
  const restored = NexAdaptive.restoreDefaults(customized);
  assert.equal(restored.profileId, 'balanced', 'restoreDefaults resets workspace profile to balanced');
  assert.equal(restored.onboarding.welcomeCompleted, true, 'restoreDefaults preserves welcomeCompleted');
  assert.equal(restored.onboarding.tourCompleted, true, 'restoreDefaults preserves tourCompleted');
  assert.equal(restored.onboarding.neverShowHints, true, 'restoreDefaults preserves neverShowHints');
  assert.deepEqual(restored.onboarding.dismissedHints, ['pin-nav', 'cmd-center'], 'restoreDefaults preserves dismissedHints');

  const presetSwitched = NexAdaptive.applyPreset('deep-work', customized);
  assert.equal(presetSwitched.onboarding.tourCompleted, true, 'applyPreset preserves onboarding flags');

  // 4. Static markup checks: 2-group parent-child containment & no 3rd Knowledge group
  const entHtml = fs.readFileSync(path.join(PUB, 'index-redesign.html'), 'utf8');
  assert.ok(entHtml.includes('data-group="workspace"') && entHtml.includes('id="ent-grp-list-workspace"'), 'Enterprise Workspace group container exists');
  assert.ok(entHtml.includes('data-group="productivity"') && entHtml.includes('id="ent-grp-list-productivity"'), 'Enterprise Productivity group container exists');
  assert.equal(entHtml.includes('data-group="knowledge"'), false, 'Legacy third Knowledge group must be removed');
  assert.ok(entHtml.includes('onboarding.js?v=4.9.2'), 'Enterprise loads onboarding.js');
  const classicHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(classicHtml.includes('onboarding.js?v=4.9.2'), 'Classic loads onboarding.js');

  console.log('Unit, migration, existing-user guard & DOM structure checks passed.');
}

async function runBrowserJourneysSuite() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('Welcome & Nav browser suite skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browser = findBrowser();
  if (!browser) {
    console.log('Welcome & Nav browser suite skipped (browser not found).');
    return;
  }

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-welcome-nav-secret';
  const app = require('../server.js');
  const shotDir = process.env.NEXOS_AUDIT_SHOT_DIR || '';

  const origReady = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const Chat = mongoose.models.Chat;
  const PushPreference = mongoose.models.PushPreference;
  const StudyDocument = mongoose.models.StudyDocument;

  const orig = {
    userFind: User.findById,
    stateFindOne: UserState.findOne,
    stateCreate: UserState.create,
    stateUpdate: UserState.findOneAndUpdate,
    chatFind: Chat.find,
    pushFindOne: PushPreference.findOne,
    studyFind: StudyDocument ? StudyDocument.find : null,
  };

  let activeUid = '507f1f77bcf86cd799439401';
  const userDocs = new Map([
    ['507f1f77bcf86cd799439401', {
      _id: 'st-new', userId: '507f1f77bcf86cd799439401', rev: 1, updatedAt: new Date(),
      data: { tasks: [], habits: [], notes: [], pomodoroLog: [] },
    }],
    ['507f1f77bcf86cd799439402', {
      _id: 'st-existing', userId: '507f1f77bcf86cd799439402', rev: 5, updatedAt: new Date(),
      data: {
        tasks: [{ id: 'ex_t1', title: 'Existing Sprint Goal', col: 'todo', priority: 'high', due: '2026-12-10', created: Date.now() }],
        habits: [{ id: 'ex_h1', name: 'Morning Review', color: '#3b82f6', checks: {}, streak: 3 }],
        notes: [{ id: 'ex_n1', title: 'Architecture Notes', content: 'Established data', tags: ['work'], pinned: true, created: Date.now() }],
        pomodoroLog: [],
        seeded: true,
        profile: { goal: 'projects', at: Date.now() - 86400000 },
        adaptivePrefs: {
          schemaVersion: 1,
          updatedAt: 5000,
          profileId: 'deep-work',
          navigation: { collapsedGroups: ['growth', 'knowledge'] },
        },
      },
    }],
  ]);

  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  User.findById = (id) => ({
    select() { return this; },
    async lean() {
      const uid = String(id || activeUid);
      return {
        _id: uid,
        name: uid.endsWith('402') ? 'Existing User' : 'New Starter',
        email: uid.endsWith('402') ? 'existing@nexos.test' : 'newstarter@nexos.test',
        picture: '',
      };
    },
  });
  UserState.findOne = (q) => ({
    select() { return this; },
    async lean() {
      const uid = String((q && q.userId) || activeUid);
      return userDocs.get(uid) || null;
    },
  });
  UserState.create = async (p) => {
    const uid = String(p.userId || activeUid);
    const created = { _id: 'st-' + uid, userId: uid, rev: 1, updatedAt: new Date(), data: p.data };
    userDocs.set(uid, created);
    return created;
  };
  UserState.findOneAndUpdate = (f, u) => ({
    select() { return this; },
    async lean() {
      const uid = String((f && f.userId) || activeUid);
      const prev = userDocs.get(uid) || { _id: 'st-' + uid, userId: uid, rev: 0 };
      const next = { ...prev, rev: (prev.rev || 0) + 1, updatedAt: new Date(), data: u.$set.data };
      userDocs.set(uid, next);
      return next;
    },
  });
  Chat.find = () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, async lean() { return []; } });
  PushPreference.findOne = () => ({ select() { return this; }, async lean() { return { enabled: true, reminderTime: '09:00' }; } });
  if (StudyDocument) {
    StudyDocument.find = () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, async lean() { return []; } });
  }

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-welc-'));
  const port = 19840 + Math.floor(Math.random() * 400);
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

    // A. Backend API PUT /api/state validation check for legacy 3-group collapsedGroups + onboarding fields
    const tokenNew = jwt.sign({ id: '507f1f77bcf86cd799439401' }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const putCheck = await fetch(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${tokenNew}` },
      body: JSON.stringify({
        expectedRev: 1,
        state: {
          tasks: [], habits: [], notes: [],
          adaptivePrefs: {
            schemaVersion: 1, updatedAt: 0, profileId: 'balanced',
            navigation: { collapsedGroups: ['growth', 'knowledge', 'invalid-group'] },
            onboarding: { welcomeCompleted: false, tourCompleted: false, dismissedHints: ['pin-nav', 'bogus-hint'], neverShowHints: false },
          },
        },
      }),
    });
    assert.equal(putCheck.status, 200, 'PUT /api/state accepts normalized two-group & onboarding payload');
    const savedNewDoc = userDocs.get('507f1f77bcf86cd799439401').data;
    assert.deepEqual(savedNewDoc.adaptivePrefs.navigation.collapsedGroups, ['productivity'], 'Server normalizes collapsedGroups on save');
    assert.deepEqual(savedNewDoc.adaptivePrefs.onboarding.dismissedHints, ['pin-nav'], 'Server strips unknown hint IDs');
    // Reset new account doc back to completely clean initial state before browser test
    userDocs.get('507f1f77bcf86cd799439401').data = { tasks: [], habits: [], notes: [], pomodoroLog: [] };
    userDocs.get('507f1f77bcf86cd799439401').rev = 1;

    // B1. Guest First-Run Skip / Cancel Preview on Enterprise (1440x900)
    await cdp.send('Network.clearBrowserCookies');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');
    await cdp.eval('localStorage.clear(); localStorage.setItem("nexos_guest_mode_v1", "1");');
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true && typeof NexOnboarding !== "undefined"');

    const guestInit = await cdp.eval(`(() => {
      const card = document.getElementById('nex-welcome-card');
      const qs = document.getElementById('qs-card');
      const hitTopbar = document.elementFromPoint(720, 26)?.tagName || '';
      document.querySelector('[data-welcome-preset="study"]')?.click();
      return {
        welcomeShown: Boolean(card && card.offsetHeight > 40),
        legacyQsHidden: Boolean(qs && qs.hidden === true),
        nonBlocking: hitTopbar !== '' && !document.querySelector('.nex-tour-modal-backdrop'),
        previewProfile: getEnterpriseAdaptivePrefs()?.profileId,
        previewFocusMin: document.getElementById('cfg-focus-min')?.value || '',
      };
    })()`);
    assert.equal(guestInit.welcomeShown, true, 'Guest empty workspace shows Smart Welcome card');
    assert.equal(guestInit.legacyQsHidden, true, 'Smart Welcome hides legacy qs-card');
    assert.equal(guestInit.nonBlocking, true, 'Welcome card does not block workspace interactions');
    assert.equal(guestInit.previewProfile, 'study', 'Clicking Study preset applies live preview');
    assert.equal(guestInit.previewFocusMin, '50', 'Clicking Study preset previews 50m focus duration');

    // Click Skip -> verify live preview reverts cleanly to balanced + 25m and stays dismissed on reload
    await cdp.eval('document.getElementById("nex-welcome-skip-btn")?.click();');
    const guestAfterSkip = await cdp.eval(`(() => ({
      welcomeRemoved: !document.getElementById('nex-welcome-card'),
      qsStillHidden: document.getElementById('qs-card')?.hidden === true,
      revertedProfile: getEnterpriseAdaptivePrefs()?.profileId,
      revertedFocusMin: document.getElementById('cfg-focus-min')?.value || '',
      skippedSaved: Boolean(getEnterpriseAdaptivePrefs()?.onboarding?.welcomeSkippedAt),
    }))()`);
    assert.equal(guestAfterSkip.welcomeRemoved, true, 'Skip closes Welcome card');
    assert.equal(guestAfterSkip.qsStillHidden, true, 'Skipping Welcome does not re-expose legacy qs-card');
    assert.equal(guestAfterSkip.revertedProfile, 'balanced', 'Skip reverts unsaved Study preset preview to baseline balanced');
    assert.equal(guestAfterSkip.revertedFocusMin, '25', 'Skip reverts previewed timer duration back to 25m');
    assert.equal(guestAfterSkip.skippedSaved, true, 'Skip persists onboarding skip flag');

    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');
    assert.equal(await cdp.eval('!document.getElementById("nex-welcome-card")'), true, 'Skipped Welcome does NOT reappear after reload');

    // B2. Signed-in Fresh Empty Account: Preview Study -> Continue to Tour -> 6-step Tour -> Reload persistence
    activeUid = '507f1f77bcf86cd799439401';
    await cdp.eval('localStorage.clear();');
    await cdp.send('Network.setCookie', { name: 'token', value: tokenNew, domain: '127.0.0.1', path: '/', httpOnly: true });
    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true && Boolean(document.getElementById("nex-welcome-card"))');

    await cdp.eval('document.querySelector(\'[data-welcome-preset="study"]\')?.click();');
    await cdp.screenshot(shotDir, '01-welcome-study-preview.png');

    // Verify 2-group inline containment even under Study preset's custom sidebar order
    const studySidebarDom = await cdp.eval(`(() => {
      const wsHeader = document.querySelector('.nav-group-toggle[data-group="workspace"]');
      const prodHeader = document.querySelector('.nav-group-toggle[data-group="productivity"]');
      const wsList = document.getElementById('ent-grp-list-workspace');
      const prodList = document.getElementById('ent-grp-list-productivity');
      const dashTop = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="dashboard"]')?.getBoundingClientRect().top || 0;
      const studyTop = document.getElementById('nav-study')?.getBoundingClientRect().top || 0;
      return {
        wsContainsDash: Boolean(wsList?.contains(document.querySelector('#ent-sidebar-nav .nav-btn[data-view="dashboard"]'))),
        prodContainsStudy: Boolean(prodList?.contains(document.getElementById('nav-study'))),
        inlineOrderOk: wsHeader.getBoundingClientRect().top < dashTop && dashTop < prodHeader.getBoundingClientRect().top && prodHeader.getBoundingClientRect().top < studyTop,
      };
    })()`);
    assert.equal(studySidebarDom.wsContainsDash && studySidebarDom.prodContainsStudy && studySidebarDom.inlineOrderOk, true, 'Two-group inline hierarchy holds cleanly during Study preset preview');

    // Continue to Tour -> seeds starter items once & enters Step 1 of 6
    await cdp.eval('document.getElementById("nex-welcome-tour-btn")?.click();');
    await cdp.waitFor('Boolean(document.getElementById("nex-tour-card"))');
    await new Promise((r) => setTimeout(r, 220));
    await cdp.screenshot(shotDir, '02-tour-step1-dashboard.png');

    const step1 = await cdp.eval(`(() => ({
      welcomeGone: !document.getElementById('nex-welcome-card'),
      tasksCount: state.tasks.length,
      notesCount: state.notes.length,
      stepText: document.querySelector('#nex-tour-card .nex-tour-step')?.textContent || '',
      prevDisabled: Boolean(document.getElementById('nex-tour-prev-btn')?.disabled),
      hlVisible: Boolean(document.getElementById('nex-tour-highlight') && !document.getElementById('nex-tour-highlight').hidden),
    }))()`);
    assert.equal(step1.welcomeGone, true, 'Welcome card hides on Continue to Tour');
    assert.ok(step1.tasksCount >= 3 && step1.notesCount >= 1, 'Continue to Tour seeds empty workspace starter items');
    assert.ok(step1.stepText.includes('Step 1 of 6'), 'Tour starts on Step 1 of 6');
    assert.equal(step1.prevDisabled, true, 'Previous button disabled on Step 1');
    assert.equal(step1.hlVisible, true, 'Tour highlight ring visible on Step 1 target');

    // Next -> Step 2 (Two Expandable Sidebar Groups) + test ArrowRight & ArrowLeft
    await cdp.eval('document.getElementById("nex-tour-next-btn")?.click();');
    await new Promise((r) => setTimeout(r, 220));
    await cdp.screenshot(shotDir, '03-tour-step2-sidebar.png');
    const step2Text = await cdp.eval('document.querySelector("#nex-tour-card .nex-tour-step")?.textContent || ""');
    assert.ok(step2Text.includes('Step 2 of 6'), 'Step 2 active');

    // Keyboard ArrowRight -> Step 3, then ArrowLeft -> Step 2, then advance to Step 6 and Finish
    await cdp.eval(`(() => {
      document.getElementById('nex-tour-next-btn')?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    assert.ok((await cdp.eval('document.querySelector("#nex-tour-card .nex-tour-step")?.textContent || ""')).includes('Step 3 of 6'), 'ArrowRight moves to Step 3');
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));');
    await new Promise((r) => setTimeout(r, 80));
    assert.ok((await cdp.eval('document.querySelector("#nex-tour-card .nex-tour-step")?.textContent || ""')).includes('Step 2 of 6'), 'ArrowLeft moves back to Step 2');

    for (let i = 0; i < 4; i++) {
      await cdp.eval('document.getElementById("nex-tour-next-btn")?.click();');
      await new Promise((r) => setTimeout(r, 70));
    }
    const step6 = await cdp.eval(`(() => ({
      stepText: document.querySelector('#nex-tour-card .nex-tour-step')?.textContent || '',
      hasFinishBtn: Boolean(document.getElementById('nex-tour-finish-btn')),
    }))()`);
    assert.ok(step6.stepText.includes('Step 6 of 6') && step6.hasFinishBtn, 'Step 6 renders Finish button');

    await cdp.eval('document.getElementById("nex-tour-finish-btn")?.click();');
    await new Promise((r) => setTimeout(r, 150));
    const afterTourFinish = await cdp.eval(`(() => ({
      tourGone: !document.getElementById('nex-tour-card'),
      tourCompleted: Boolean(getEnterpriseAdaptivePrefs()?.onboarding?.tourCompleted),
      welcomeCompleted: Boolean(getEnterpriseAdaptivePrefs()?.onboarding?.welcomeCompleted),
    }))()`);
    assert.equal(afterTourFinish.tourGone && afterTourFinish.tourCompleted && afterTourFinish.welcomeCompleted, true, 'Finishing tour persists completion state');

    // Wait briefly so debounced PUT /api/state persists before reload
    await new Promise((r) => setTimeout(r, 950));
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');
    const postReloadNew = await cdp.eval(`(() => ({
      profileId: getEnterpriseAdaptivePrefs()?.profileId,
      noWelcome: !document.getElementById('nex-welcome-card'),
      noTour: !document.getElementById('nex-tour-card'),
      taskCount: state.tasks.length,
    }))()`);
    assert.equal(postReloadNew.profileId, 'study', 'Selected Study preset persisted across reload');
    assert.equal(postReloadNew.noWelcome && postReloadNew.noTour, true, 'Completed onboarding does NOT restart on reload');
    assert.equal(postReloadNew.taskCount, step1.tasksCount, 'Reload never duplicates starter tasks');

    // C. Existing Established User Protection + Legacy 3-Group Server Migration + Replay + Escape + Hints
    activeUid = '507f1f77bcf86cd799439402';
    const tokenExisting = jwt.sign({ id: '507f1f77bcf86cd799439402' }, process.env.JWT_SECRET, { expiresIn: '2h' });
    await cdp.eval('localStorage.clear();');
    await cdp.send('Network.setCookie', { name: 'token', value: tokenExisting, domain: '127.0.0.1', path: '/', httpOnly: true });
    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');

    const existingCheck = await cdp.eval(`(() => ({
      noWelcome: !document.getElementById('nex-welcome-card'),
      noTour: !document.getElementById('nex-tour-card'),
      qsHidden: document.getElementById('qs-card')?.hidden === true,
      migratedCollapsed: getEnterpriseAdaptivePrefs()?.navigation?.collapsedGroups || [],
      prodCollapsedApplied: document.getElementById('ent-grp-list-productivity')?.hidden === true,
      taskCount: state.tasks.length,
    }))()`);
    assert.equal(existingCheck.noWelcome && existingCheck.noTour && existingCheck.qsHidden, true, 'Existing user never receives unprompted onboarding');
    assert.deepEqual(existingCheck.migratedCollapsed, ['productivity'], 'Existing user legacy collapsedGroups migrated to 2 groups cleanly');
    assert.equal(existingCheck.prodCollapsedApplied, true, 'Migrated collapsed productivity group renders collapsed cleanly');

    // Replay Tour manually from Enterprise Settings -> closes Settings -> test Escape exits cleanly and restores focus
    await cdp.eval(`(() => {
      openEnterpriseSettingsModal('general');
      document.getElementById('ent-start-tour-btn')?.click();
    })()`);
    await cdp.waitFor('Boolean(document.getElementById("nex-tour-card"))');
    const replayOpenCheck = await cdp.eval(`(() => ({
      settingsClosed: !document.getElementById('modal-enterprise-settings')?.classList.contains('open'),
      tourStep1: (document.querySelector('#nex-tour-card .nex-tour-step')?.textContent || '').includes('Step 1 of 6'),
    }))()`);
    assert.equal(replayOpenCheck.settingsClosed && replayOpenCheck.tourStep1, true, 'Replaying tour from Settings closes modal and launches Step 1');

    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));');
    await new Promise((r) => setTimeout(r, 120));
    const afterEsc = await cdp.eval(`(() => ({
      tourGone: !document.getElementById('nex-tour-card'),
      activeId: document.activeElement?.id || '',
      tourSkippedAt: getEnterpriseAdaptivePrefs()?.onboarding?.tourSkippedAt || 0,
      taskCount: state.tasks.length,
    }))()`);
    assert.equal(afterEsc.tourGone, true, 'Escape key exits tour cleanly');
    assert.equal(afterEsc.activeId, 'ent-sb-settings-btn', 'Escape restores keyboard focus to visible Settings button');
    assert.ok(afterEsc.tourSkippedAt > 0, 'Escape records tourSkippedAt');
    assert.equal(afterEsc.taskCount, existingCheck.taskCount, 'Replaying & exiting tour leaves existing user tasks untouched');

    // Contextual Feature Discovery Hint + Never show tips + reset persistence check
    await cdp.eval(`(() => {
      openEnterpriseSettingsModal('navigation');
    })()`);
    await new Promise((r) => setTimeout(r, 120));
    const hintShown = await cdp.eval('Boolean(document.getElementById("nex-hint-pill"))');
    assert.equal(hintShown, true, 'Navigation Settings tab triggers contextual pin-nav hint');
    await cdp.eval('document.querySelector("#nex-hint-pill .nex-hint-link.muted")?.click();');
    const afterNever = await cdp.eval(`(() => ({
      pillRemoved: !document.getElementById('nex-hint-pill'),
      neverShowHints: Boolean(getEnterpriseAdaptivePrefs()?.onboarding?.neverShowHints),
    }))()`);
    assert.equal(afterNever.pillRemoved && afterNever.neverShowHints, true, 'Clicking Never show tips persists neverShowHints');

    // Visual reset preserves neverShowHints & existing user tasks when reopening Welcome manually
    await cdp.eval(`(() => {
      restoreEnterpriseWorkspaceDefaults();
      closeModal('modal-enterprise-settings');
      NexOnboarding.openWelcome();
    })()`);
    await cdp.waitFor('Boolean(document.getElementById("nex-welcome-card"))');
    const manualWelcomeExisting = await cdp.eval(`(() => {
      document.querySelector('[data-welcome-preset="minimal"]')?.click();
      document.getElementById('nex-welcome-finish-btn')?.click();
      return {
        neverShowStillTrue: Boolean(getEnterpriseAdaptivePrefs()?.onboarding?.neverShowHints),
        profileApplied: getEnterpriseAdaptivePrefs()?.profileId,
        taskCount: state.tasks.length,
        origTaskStillThere: state.tasks[0]?.title === 'Existing Sprint Goal',
      };
    })()`);
    assert.equal(manualWelcomeExisting.neverShowStillTrue, true, 'Workspace reset preserves neverShowHints');
    assert.equal(manualWelcomeExisting.profileApplied, 'minimal', 'Manual Welcome updates profile layout cleanly');
    assert.equal(manualWelcomeExisting.taskCount, 1 && manualWelcomeExisting.origTaskStillThere ? 1 : -1, 'Manual Welcome never overwrites or duplicates existing user items');

    // D. Light Theme (apple-light) screenshots for contrast/visual verification
    await cdp.eval(`(() => {
      applyNexusTheme('apple-light');
      NexOnboarding.openWelcome();
    })()`);
    await cdp.waitFor('Boolean(document.getElementById("nex-welcome-card"))');
    await new Promise((r) => setTimeout(r, 150));
    await cdp.screenshot(shotDir, '04-welcome-light-theme.png');
    await cdp.eval(`(() => {
      NexOnboarding.dismissWelcome('later');
      NexOnboarding.startTour({ surface: 'enterprise' });
    })()`);
    await cdp.waitFor('Boolean(document.getElementById("nex-tour-card"))');
    await new Promise((r) => setTimeout(r, 200));
    await cdp.screenshot(shotDir, '05-tour-light-theme.png');
    await cdp.eval('NexOnboarding.skipTour(); applyNexusTheme("cyber-aubergine");');

    // E. Mobile 390x844 + 9-Viewport Overflow Audit + Classic Surface Verification
    const viewports = [
      [1920, 1080], [1440, 900], [1280, 800], [1024, 768],
      [900, 700], [768, 1024], [430, 932], [390, 844], [320, 700],
    ];
    for (const [vw, vh] of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: vw <= 768 });
      await cdp.eval('if (typeof applyEnterpriseSidebarPrefs === "function") applyEnterpriseSidebarPrefs();');
      await new Promise((r) => setTimeout(r, 50));
      const ov = await cdp.eval('document.documentElement.scrollWidth - window.innerWidth');
      assert.ok(ov <= 1, `Enterprise viewport ${vw}x${vh} has zero horizontal overflow (got ${ov})`);
    }

    // Mobile 390x844 Welcome + Tour Step 2 drawer inspection screenshots
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.eval('applyEnterpriseSidebarPrefs(); NexOnboarding.openWelcome();');
    await cdp.waitFor('Boolean(document.getElementById("nex-welcome-card"))');
    await new Promise((r) => setTimeout(r, 150));
    const mobWelcomeOv = await cdp.eval('document.documentElement.scrollWidth - window.innerWidth');
    assert.ok(mobWelcomeOv <= 1, `Mobile 390x844 Welcome has zero overflow (got ${mobWelcomeOv})`);
    await cdp.screenshot(shotDir, '06-mobile-390-welcome.png');

    await cdp.eval('NexOnboarding.dismissWelcome("later"); NexOnboarding.startTour({ surface: "enterprise" }); NexOnboarding.nextTourStep();');
    await new Promise((r) => setTimeout(r, 220));
    const mobTourDrawer = await cdp.eval(`(() => ({
      drawerOpen: document.getElementById('app-sidebar')?.classList.contains('open'),
      cardVisible: Boolean(document.getElementById('nex-tour-card')),
      ov: document.documentElement.scrollWidth - window.innerWidth,
    }))()`);
    assert.equal(mobTourDrawer.drawerOpen && mobTourDrawer.cardVisible, true, 'Mobile Tour Step 2 opens sidebar drawer cleanly');
    assert.ok(mobTourDrawer.ov <= 1, 'Mobile Tour Step 2 stays within viewport');
    await cdp.screenshot(shotDir, '07-mobile-390-tour-sidebar.png');
    await cdp.eval('NexOnboarding.finishTour();');

    // Classic /classic Desktop Tour & Settings Integration Check
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof openProfile === "function" && typeof NexOnboarding !== "undefined" && NexOnboarding.isReady()');
    const classicCheck = await cdp.eval(`(() => {
      openProfile('general');
      const hasControls = Boolean(
        document.getElementById('classic-open-welcome-btn')
        && document.getElementById('classic-start-tour-btn')
        && document.getElementById('classic-pref-tips-enabled')
      );
      document.getElementById('classic-start-tour-btn')?.click();
      return {
        hasControls,
        tourActive: NexOnboarding.isTourActive(),
        stepText: document.querySelector('#nex-tour-card .nex-tour-step')?.textContent || '',
      };
    })()`);
    assert.equal(classicCheck.hasControls && classicCheck.tourActive, true, 'Classic Settings General exposes Onboarding & Tour controls cleanly');
    assert.ok(classicCheck.stepText.includes('Step 1 of 6'), 'Classic Tour runs all 6 steps');
    await cdp.eval('NexOnboarding.nextTourStep();');
    await new Promise((r) => setTimeout(r, 200));
    await cdp.screenshot(shotDir, '08-classic-tour-desktop.png');
    await cdp.eval('NexOnboarding.finishTour();');

    assert.deepEqual(cdp.errors, [], `Zero runtime/console errors expected, got: ${cdp.errors.join(' | ')}`);
    assert.deepEqual(cdp.badResponses, [], `Zero unexpected HTTP errors expected, got: ${cdp.badResponses.join(' | ')}`);
    console.log('NexOS 4.9.0 Welcome & Two-Group Navigation Chromium verification passed across all journeys & 9 viewports.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => srv.close(r));
    setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }, 150);
    if (origReady) Object.defineProperty(mongoose.connection, 'readyState', origReady);
    User.findById = orig.userFind;
    UserState.findOne = orig.stateFindOne;
    UserState.create = orig.stateCreate;
    UserState.findOneAndUpdate = orig.stateUpdate;
    Chat.find = orig.chatFind;
    PushPreference.findOne = orig.pushFindOne;
    if (StudyDocument && orig.studyFind) StudyDocument.find = orig.studyFind;
  }
}

(async () => {
  runUnitAndMigrationChecks();
  await runBrowserJourneysSuite();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
