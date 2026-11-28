'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean).find((p) => fs.existsSync(p));
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    this.badNet = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params?.exceptionDetails;
        this.errors.push(d?.exception?.description || d?.text || 'Uncaught exception');
      } else if (m.method === 'Console.messageAdded' && m.params?.message?.level === 'error') {
        const txt = m.params.message.text || '';
        if (!/status of 401|net::ERR|accounts\.google|fonts\.googleapis|cdn\.jsdelivr/i.test(txt)) {
          this.errors.push(txt);
        }
      } else if (m.method === 'Network.responseReceived') {
        const r = m.params?.response;
        const expectedGuest401 = r && r.status === 401 && /\/api\/(bootstrap|state|chats|push\/|study\/)/.test(r.url);
        if (r && r.url && r.url.startsWith('http://127.0.0.1:') && r.status >= 400 && !expectedGuest401) {
          this.badNet.push(`${r.status} ${r.url}`);
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
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  }
  async waitFor(pred, ms = 9000) {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error('Timeout waiting for: ' + pred);
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitWs(port) {
  const s = Date.now();
  while (Date.now() - s < 9000) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for Chrome CDP endpoint');
}

(async () => {
  const browser = findBrowser();
  if (!browser) {
    console.log('No Chromium binary found; skipping browser portion cleanly.');
    process.exit(0);
  }

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-zero-defect-490-secret';
  const app = require(path.join(ROOT, 'server.js'));
  const uid = '507f1f77bcf86cd799439888';
  const token = jwt.sign({ id: uid }, process.env.JWT_SECRET, { expiresIn: '2h' });

  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const Chat = mongoose.models.Chat;
  const PushPreference = mongoose.models.PushPreference;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  const td = new Date().toISOString().slice(0, 10);
  let doc = {
    _id: 'st-zd',
    userId: uid,
    rev: 1,
    updatedAt: new Date(),
    data: {
      tasks: [],
      habits: [],
      notes: [
        { id: 'zn_a', title: 'Alpha Note', content: 'Alpha summary content for race test.', tags: [], pinned: false, created: Date.now() },
        { id: 'zn_b', title: 'Beta Note', content: 'Beta summary content for supersede test.', tags: [], pinned: false, created: Date.now() },
      ],
      pomodoroLog: [{ date: td, minutes: 25 }],
      seeded: true,
      profile: { goal: 'projects' },
    },
  };
  User.findById = () => ({ select() { return this; }, async lean() { return { _id: uid, name: 'ZD Tester', email: 'zd@nexos.test', picture: '' }; } });
  UserState.findOne = () => ({ select() { return this; }, async lean() { return doc; } });
  UserState.create = async (p) => { doc = { ...doc, data: p.data }; return doc; };
  UserState.findOneAndUpdate = (f, u) => ({ select() { return this; }, async lean() { doc = { ...doc, rev: (doc.rev || 1) + 1, data: u.$set.data }; return doc; } });
  Chat.find = () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, async lean() { return []; } });
  PushPreference.findOne = () => ({ select() { return this; }, async lean() { return { enabled: false, reminderTime: '09:00' }; } });
  if (mongoose.models.StudyDocument) {
    mongoose.models.StudyDocument.find = () => ({ sort() { return this; }, select() { return this; }, async lean() { return []; } });
  }

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-zd-'));
  const port = 19710 + Math.floor(Math.random() * 400);
  const chrome = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`, 'about:blank'], { stdio: 'ignore' });
  let cdp;

  try {
    cdp = new CDP(await waitWs(port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');

    // ---------------- 1. CLASSIC GUEST REGRESSIONS (ZD-001..ZD-007, ZD-009, ZD-012, ZD-014, ZD-015) ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval(`startGuest(); if (typeof finishQuickStart === 'function' && document.getElementById('quickstart-modal')?.classList.contains('is-open')) finishQuickStart(true);`);
    await cdp.waitFor('document.getElementById("sidebar") !== null');

    const cRes = await cdp.eval(`(() => {
      const r = {};
      const sb = document.getElementById('sidebar');
      const main = document.getElementById('main');
      const colBtn = document.getElementById('classic-sidebar-collapse');

      // ZD-001 & ZD-003 & ZD-006: Soft design collapse/expand + button aria + toast clearance
      NexUI.setDesign('google');
      if (document.body.classList.contains('sidebar-compact')) colBtn.click();
      r.softExpW = Math.round(sb.getBoundingClientRect().width);
      r.softExpMain = getComputedStyle(main).marginLeft;
      r.softExpLabel = colBtn.getAttribute('aria-label');

      colBtn.click();
      r.softCmpW = Math.round(sb.getBoundingClientRect().width);
      r.softCmpMain = getComputedStyle(main).marginLeft;
      r.softCmpLabel = colBtn.getAttribute('aria-label');
      r.softCmpPressed = colBtn.getAttribute('aria-pressed');
      notify('ZD Toast Clearance');
      const tcSoft = document.getElementById('toasts').getBoundingClientRect();
      r.softToastClear = Math.round(tcSoft.left) >= Math.round(sb.getBoundingClientRect().right);

      // ZD-002: Hover tooltip renders outside compact rail + clears on pointerleave
      const kanbanBtn = document.querySelector('#classic-sidebar-nav .nav-item[data-view="kanban"]');
      kanbanBtn.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      const tip = document.getElementById('classic-rail-tooltip');
      r.tipVisible = Boolean(tip && tip.classList.contains('visible') && tip.getBoundingClientRect().left >= sb.getBoundingClientRect().right);
      kanbanBtn.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      r.tipCleared = Boolean(tip && !tip.classList.contains('visible'));

      // ZD-003: Keyboard arrow movement inside Classic sidebar nav
      kanbanBtn.focus();
      document.getElementById('classic-sidebar-nav').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      r.arrowMovedFocus = document.activeElement !== kanbanBtn && document.activeElement?.closest('#classic-sidebar-nav') !== null;

      // ZD-001: Glass design collapse width (64px rail, 88px main margin) + toast clearance
      NexUI.setDesign('apple');
      r.appleCmpW = Math.round(sb.getBoundingClientRect().width);
      r.appleCmpMain = getComputedStyle(main).marginLeft;
      const tcApple = document.getElementById('toasts').getBoundingClientRect();
      r.appleToastClear = Math.round(tcApple.left) >= Math.round(sb.getBoundingClientRect().right);

      // ZD-005: Recent list deduplicates active, pinned, and hidden destinations
      switchView('habits');
      switchView('notes');
      switchView('dashboard');
      const recLabels = [...document.querySelectorAll('#classic-nav-recent button')].map(b => b.textContent.trim());
      r.recentExcludesHome = !recLabels.includes('Home');

      // ZD-007 & ZD-009 & ZD-015: Settings Guest Notifications + 6-pin cap + Modal stacks above Toasts
      openProfile('all');
      r.modalAboveToasts = Number(getComputedStyle(document.getElementById('profile-modal')).zIndex) > Number(getComputedStyle(document.getElementById('toasts')).zIndex);
      document.querySelector('#classic-settings-cats [data-cat="notifications"]')?.click();
      r.guestNotifEmpty = !document.getElementById('classic-settings-empty').hidden;
      r.guestNotifHasInfo = !document.getElementById('classic-settings-guest-notif').hidden;
      r.guestHiddenAllTrue = ['profile-name-section', 'profile-delete-section', 'profile-reminders-section'].every(id => document.getElementById(id)?.hidden === true);

      document.querySelector('#classic-settings-cats [data-cat="navigation"]')?.click();
      for (let i = 0; i < 8; i++) {
        const b = [...document.querySelectorAll('#classic-settings-nav-list button[aria-pressed="false"]')][0];
        if (!b || b.disabled) break;
        b.click();
      }
      const remUnpinned = [...document.querySelectorAll('#classic-settings-nav-list button[aria-pressed="false"]')];
      r.classicPinCount = getClassicAdaptivePrefs().navigation.pinned.length;
      r.classicPinCapDisabled = remUnpinned.length > 0 && remUnpinned.every(b => b.disabled);

      window.confirm = () => true;
      resetAllClassicPreferences();
      closeProfile();

      // ZD-012: Classic Pomodoro midnight rollover resets stale stats
      state.pomodoroStats = { totalToday: 75, sessionsToday: 3, longestStreak: 3, lastDate: '2000-01-01' };
      pomState.mode = 'focus';
      pomSessionComplete(true);
      r.midnightResetOk = state.pomodoroStats.sessionsToday === 1 && state.pomodoroStats.totalToday === pomDurations.focus && state.pomodoroStats.lastDate === today();

      // Enable compact sidebar to test reload persistence & 900px breakpoint transition next
      toggleClassicSidebarCompact();
      r.compactBeforeReload = document.body.classList.contains('sidebar-compact');
      return r;
    })()`);

    assert.equal(cRes.softExpW, 256);
    assert.equal(cRes.softExpMain, '256px');
    assert.equal(cRes.softCmpW, 76);
    assert.equal(cRes.softCmpMain, '76px');
    assert.equal(cRes.softExpLabel, 'Collapse sidebar');
    assert.equal(cRes.softCmpLabel, 'Expand sidebar');
    assert.equal(cRes.softCmpPressed, 'true');
    assert.equal(cRes.softToastClear, true, 'Soft compact toast clears sidebar');
    assert.equal(cRes.tipVisible, true, 'Compact hover tooltip floats cleanly outside rail');
    assert.equal(cRes.tipCleared, true, 'Compact hover tooltip hides on pointerleave');
    assert.equal(cRes.arrowMovedFocus, true, 'Sidebar arrow key navigates items');
    assert.equal(cRes.appleCmpW, 64, 'Glass compact rail shrinks to 64px instead of expanding');
    assert.equal(cRes.appleCmpMain, '88px');
    assert.equal(cRes.appleToastClear, true, 'Glass compact toast clears sidebar');
    assert.equal(cRes.recentExcludesHome, true, 'Recent destinations exclude active view');
    assert.equal(cRes.modalAboveToasts, true, 'Classic modals stack cleanly above toast shelf');
    assert.equal(cRes.guestNotifEmpty, false, 'Guest Settings Notifications never renders dead empty state');
    assert.equal(cRes.guestNotifHasInfo, true, 'Guest Settings Notifications displays push guidance card');
    assert.equal(cRes.guestHiddenAllTrue, true, 'Guest-excluded sections strictly set hidden=true');
    assert.equal(cRes.classicPinCount, 6);
    assert.equal(cRes.classicPinCapDisabled, true, 'Classic 6-pin limit disables unpinned buttons with tooltip');
    assert.equal(cRes.midnightResetOk, true, 'Classic Pomodoro midnight rollover resets stale daily counts');
    assert.equal(cRes.compactBeforeReload, true);

    // Verify compact rail persists on reload AND 900px exact breakpoint behaves cleanly (ZD-001, ZD-004, ZD-014)
    await cdp.send('Page.reload');
    await cdp.waitFor('document.readyState === "complete" && typeof toggleSidebar === "function"');
    const reloadedCompact = await cdp.eval(`({ compact: document.body.classList.contains('sidebar-compact'), sbW: Math.round(document.getElementById('sidebar').getBoundingClientRect().width) })`);
    assert.equal(reloadedCompact.compact, true);
    assert.equal(reloadedCompact.sbW, 76);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.eval(`window.dispatchEvent(new Event('resize'));`);
    await new Promise((r) => setTimeout(r, 40));
    const bp900 = await cdp.eval(`(() => {
      const compactRemoved = !document.body.classList.contains('sidebar-compact');
      toggleSidebar();
      const drawerOpenedAt900 = document.getElementById('sidebar').classList.contains('open');
      openStudyStudio();
      const drawerClosedByStudyAt900 = !document.getElementById('sidebar').classList.contains('open');
      NexStudy.close();
      return { compactRemoved, drawerOpenedAt900, drawerClosedByStudyAt900, ov: document.documentElement.scrollWidth - window.innerWidth };
    })()`);
    assert.equal(bp900.compactRemoved, true, 'Compact rail yields to mobile drawer at exact 900px');
    assert.equal(bp900.drawerOpenedAt900, true, 'Hamburger drawer opens cleanly at exact 900px boundary');
    assert.equal(bp900.drawerClosedByStudyAt900, true, 'Opening Study Studio at 900px closes mobile drawer');
    assert.ok(bp900.ov <= 0, 'No horizontal overflow at 900px');

    // ---------------- 2. CLASSIC AUTHENTICATED NOTES SUPERSEDE (ZD-012) ----------------
    await cdp.send('Network.setCookie', { name: 'token', value: token, url: base, httpOnly: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof currentUser === "object" && currentUser && !currentUser.guest');

    const noteSupersede = await cdp.eval(`(async () => {
      switchView('notes');
      const origFetch = window.fetch;
      window.fetch = async (url, init) => {
        if (String(url).includes('/api/complete')) {
          await new Promise(r => setTimeout(r, 60));
          return new Response(JSON.stringify({ text: 'Summary Result' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(url, init);
      };
      openNote('zn_a');
      const pA = summarizeNote();
      await new Promise(r => setTimeout(r, 15));
      openNote('zn_b');
      const pB = summarizeNote();
      await Promise.all([pA, pB]);
      window.fetch = origFetch;
      return {
        aHas: state.notes.find(n => n.id === 'zn_a').content.includes('## AI Summary'),
        bHas: state.notes.find(n => n.id === 'zn_b').content.includes('## AI Summary'),
      };
    })()`);
    assert.equal(noteSupersede.aHas, false, 'Stale Note A summary superseded cleanly when user triggered Note B');
    assert.equal(noteSupersede.bHas, true, 'Note B summary saved cleanly after switching from Note A');

    // ---------------- 3. ENTERPRISE REGRESSIONS (ZD-008, ZD-009, ZD-010, ZD-011) ----------------
    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof switchNexusView === "function" && enterpriseSession.mode === "account"');

    const eRes = await cdp.eval(`(async () => {
      applyNexusTheme('cobalt-lime-dark');
      openEnterpriseSettingsModal('navigation');
      for (let i = 0; i < 10; i++) {
        const b = [...document.querySelectorAll('#ent-settings-nav-list button[aria-pressed="false"]')][0];
        if (!b || b.disabled) break;
        b.click();
      }
      const unp = [...document.querySelectorAll('#ent-settings-nav-list button[aria-pressed="false"]')];
      const entPinCount = getEnterpriseAdaptivePrefs().navigation.pinned.length;
      const entPinDisabled = unp.length > 0 && unp.every(b => b.disabled);

      window.confirm = () => true;
      resetAllEnterprisePreferences();
      const resetTheme = state.theme;
      const resetAttr = document.documentElement.getAttribute('data-theme');

      // ZD-010: Share calendar in slot 1, then verify Classic mobile bottom nav pads back to 5 buttons
      commitEnterpriseAdaptivePrefs(NexAdaptive.setMobilePrimary(getEnterpriseAdaptivePrefs(), 1, 'calendar'), { renderControls: true });
      await persistEnterpriseWorkspace();
      closeModal('modal-enterprise-settings');

      // ZD-011: Calendar renders out-of-window 06:00 and 23:00 tasks in their true hourly slots
      state.tasks.push(
        { id: 'ecal_6', title: 'Early 06h Task', stage: 'todo', priority: 'medium', due: today(), scheduledHour: 6, created: Date.now() },
        { id: 'ecal_23', title: 'Late 23h Task', stage: 'todo', priority: 'low', due: today(), scheduledHour: 23, created: Date.now() }
      );
      switchNexusView('calendar');
      const rows = [...document.querySelectorAll('#calendar-hourly-grid .calendar-hour-row')];
      const at06 = rows.find(el => el.querySelector('.hour-time-label')?.textContent?.trim() === '06:00')?.textContent?.includes('Early 06h Task');
      const at23 = rows.find(el => el.querySelector('.hour-time-label')?.textContent?.trim() === '23:00')?.textContent?.includes('Late 23h Task');

      return { entPinCount, entPinDisabled, resetTheme, resetAttr, at06: Boolean(at06), at23: Boolean(at23) };
    })()`);
    assert.equal(eRes.entPinCount, 6);
    assert.equal(eRes.entPinDisabled, true, 'Enterprise 6-pin cap disables unpinned Pin buttons');
    assert.equal(eRes.resetTheme, 'cyber-aubergine', 'Reset preferences restores Enterprise default Ember theme');
    assert.equal(eRes.resetAttr, 'cyber-aubergine');
    assert.equal(eRes.at06, true, 'Calendar places 06:00 scheduled task inside 06:00 slot');
    assert.equal(eRes.at23, true, 'Calendar places 23:00 scheduled task inside 23:00 slot');

    // Verify ZD-010 on Classic mobile after Enterprise synced calendar into mobilePrimary[1]
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof renderClassicMobileNav === "function"');
    const mobBar = await cdp.eval(`(() => {
      renderClassicMobileNav();
      const btns = [...document.querySelectorAll('#bottom-nav button')];
      return { count: btns.length, ov: document.documentElement.scrollWidth - window.innerWidth };
    })()`);
    assert.equal(mobBar.count, 5, 'Classic mobile bottom bar pads to 4+1=5 buttons when shared mobilePrimary includes calendar');
    assert.ok(mobBar.ov <= 0, 'No horizontal overflow at 390px');

    // ---------------- 4. RECOVERY CENTER SANITIZATION REGRESSION (ZD-013) ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/recover.html` });
    await cdp.waitFor('document.readyState === "complete" && typeof window.NexRecover === "object"');
    const recRes = await cdp.eval(`(() => {
      const payload = JSON.stringify({
        nexosBackupVersion: 1,
        exportedAt: 'invalid-date-value',
        state: {
          tasks: [],
          habits: [],
          notes: [],
          pomodoroLog: [],
          pomodoroStats: { totalToday: -40, sessionsToday: 'bad', longestStreak: -5, lastDate: '<img src=x>' }
        }
      });
      const v = window.NexRecover.validateAndSanitizeBackup(payload);
      document.getElementById('backup-json-paste').value = payload;
      document.getElementById('backup-validate-btn').click();
      return {
        exportedAt: v.exportedAt,
        stats: v.state.pomodoroStats,
        previewTitle: document.getElementById('backup-preview-title')?.textContent,
      };
    })()`);
    assert.equal(recRes.exportedAt, null, 'Malformed exportedAt normalized to null');
    assert.deepEqual(recRes.stats, { totalToday: 0, sessionsToday: 0, longestStreak: 0, lastDate: '' }, 'Pomodoro stats strictly sanitized');
    assert.equal(recRes.previewTitle, 'Validated NexOS backup', 'Recovery preview never displays Invalid Date');

    assert.deepEqual(cdp.errors, []);
    assert.deepEqual(cdp.badNet, []);
    console.log('NexOS 4.9.0 Project Zero-Defect regression checks passed cleanly!');
  } finally {
    cdp?.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => srv.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
