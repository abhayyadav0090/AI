'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.dialogs = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.dialogs.push({ type: msg.params?.type || '', message: msg.params?.message || '' });
        this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'Uncaught exception';
        if (!/accounts\.google\.com|cdn\.jsdelivr\.net|fonts\.googleapis/i.test(desc)) {
          this.exceptions.push(desc);
        }
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
        if (!/Failed to load resource: net::ERR|accounts\.google\.com|fonts\.googleapis|cdn\.jsdelivr\.net/i.test(text)) {
          this.consoleErrors.push(text);
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
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval failed');
    }
    return res.result?.value;
  }

  async waitFor(predicateJs, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(`Boolean(${predicateJs})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error('Timed out waiting for: ' + predicateJs);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitForDevToolsWs(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('Chrome DevTools JSON endpoint did not become ready');
}

function parseRgb(str) {
  const m = String(str || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function relLum({ r, g, b }) {
  const ch = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(fgStr, bgStr) {
  const fg = parseRgb(fgStr);
  const bg = parseRgb(bgStr);
  if (!fg || !bg) return 0;
  const L1 = relLum(fg);
  const L2 = relLum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

(async function main() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('NexOS 4.7.0 product polish browser suite skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('NexOS 4.7.0 product polish browser suite skipped (Chrome/Edge binary not found).');
    return;
  }

  const app = require('../server.js');
  const httpServer = http.createServer(app);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const urlBase = `http://127.0.0.1:${httpServer.address().port}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-cdp-polish-'));
  const port = 19640 + Math.floor(Math.random() * 900);
  const chrome = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const wsUrl = await waitForDevToolsWs(port);
    cdp = new CDPClient(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ── 1. CLASSIC (/): Dashboard ordering, Kanban filter/search across Board+List, Notes switch, Pomodoro reload, Offline Analytics, Study Studio shortcuts, Responsive viewports ──
    await cdp.send('Page.navigate', { url: `${urlBase}/` });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval(`(async () => {
      startGuest();
      if (typeof finishQuickStart === 'function') await finishQuickStart(true);
      if (typeof closeQuickStart === 'function') closeQuickStart();
      document.querySelectorAll('.modal-overlay.is-open').forEach((el) => el.classList.remove('is-open'));
    })()`);

    const classicCheck = await cdp.eval(`(async () => {
      const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); })();
      const nextWk = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return dateKey(d); })();
      state.tasks = [
        { id: 'c_high_future', title: 'High future sprint', col: 'todo', priority: 'high', due: nextWk, created: Date.now() },
        { id: 'c_overdue', title: 'Overdue low item #ops', col: 'inprogress', priority: 'low', due: yest, created: Date.now() },
        { id: 'c_med_none', title: 'Regular medium task', col: 'review', priority: 'medium', due: '', created: Date.now() }
      ];
      state.notes = [
        { id: 'cn1', title: 'Alpha Immediate Note', content: 'Body renders immediately', updated: Date.now(), pinned: true }
      ];
      state.habits = [
        { id: 'ch1', name: 'Read Daily', color: '#0A84FF', checks: { [today()]: true }, goal: 7, streak: 0 }
      ];
      renderDashboard();
      renderKanban();
      renderHabits();

      const dashTitles = Array.from(document.querySelectorAll('#dash-tasks-list .dash-task-title')).map((el) => el.textContent.trim());
      const dashHasOverdueBadge = Boolean(document.querySelector('#dash-tasks-list .due-chip.overdue'));

      openNoteFromDash('cn1');
      const noteTitleImmediate = document.getElementById('note-title-input')?.value || '';
      const noteBodyImmediate = document.getElementById('note-content')?.value || '';

      switchView('kanban');
      const overdueBoardChip = Boolean(document.querySelector('#kanban-board .due-chip.overdue'));
      const searchEl = document.getElementById('kanban-search-input');
      searchEl.value = '#ops';
      filterClassicKanban();
      const searchBoardCount = document.querySelectorAll('#kanban-board .task-card').length;

      searchEl.value = '';
      setClassicKanbanFilter('overdue', document.querySelector('#classic-kanban-filter-bar .filter-btn[data-kf="overdue"]'));
      const overdueBoardCount = document.querySelectorAll('#kanban-board .task-card').length;

      NexUI.setTaskView('list');
      const overdueListCount = document.querySelectorAll('#task-list-view .tl-row').length;
      NexUI.setTaskView('board');
      setClassicKanbanFilter('all', document.querySelector('#classic-kanban-filter-bar .filter-btn[data-kf="all"]'));

      // Offline analytics summary check (no Chart global in sandbox / offline)
      window.Chart = undefined;
      switchView('analytics');
      await renderAnalytics();
      const offlineBoxCount = document.querySelectorAll('#view-analytics .chart-unavailable').length;
      const offlineStatCount = document.querySelectorAll('#view-analytics .offline-chart-stat').length;

      // Pomodoro: start running timer, check cancelClassicAutoStart on resetPomodoro, keep running for reload test
      setMode('focus');
      focusOnTask('c_overdue');
      const pomoRunningBeforeReload = pomState.running;
      const pomoSavedRaw = localStorage.getItem('nexos_classic_pomo_v1');

      // Reset clears auto-start timer cleanly
      pomSessionComplete();
      resetPomodoro();
      const autoTimerClearedOnReset = pomAutoStartTimer === null && pomState.running === false;

      // Restart focus session on task for reload persistence test
      setMode('focus');
      focusOnTask('c_overdue');

      return {
        dashFirst: dashTitles[0] || '',
        dashHasOverdueBadge,
        noteTitleImmediate,
        noteBodyImmediate,
        overdueBoardChip,
        searchBoardCount,
        overdueBoardCount,
        overdueListCount,
        offlineBoxCount,
        offlineStatCount,
        pomoRunningBeforeReload,
        pomoSavedHasEndAt: Boolean(pomoSavedRaw && JSON.parse(pomoSavedRaw).endAt > Date.now()),
        autoTimerClearedOnReset,
      };
    })()`);

    assert.equal(classicCheck.dashFirst, 'Overdue low item #ops', 'Classic Dashboard sorts overdue task before non-overdue high priority');
    assert.equal(classicCheck.dashHasOverdueBadge, true, 'Classic Dashboard renders overdue badge');
    assert.equal(classicCheck.noteTitleImmediate, 'Alpha Immediate Note', 'Classic openNoteFromDash populates note title immediately');
    assert.equal(classicCheck.noteBodyImmediate, 'Body renders immediately', 'Classic openNoteFromDash populates note content immediately');
    assert.equal(classicCheck.overdueBoardChip, true, 'Classic Kanban card renders overdue dueChip');
    assert.equal(classicCheck.searchBoardCount, 1, 'Classic Kanban search filters by #ops');
    assert.equal(classicCheck.overdueBoardCount, 1, 'Classic Kanban Overdue filter isolates overdue card');
    assert.equal(classicCheck.overdueListCount, 1, 'Classic Task List View applies same Overdue filter');
    assert.ok(classicCheck.offlineBoxCount >= 2 && classicCheck.offlineStatCount >= 2, 'Classic offline analytics shows real summary stats when Chart.js is absent');
    assert.equal(classicCheck.pomoRunningBeforeReload, true, 'Classic focusOnTask starts focus timer');
    assert.equal(classicCheck.pomoSavedHasEndAt, true, 'Classic Pomodoro persists running endAt to localStorage');
    assert.equal(classicCheck.autoTimerClearedOnReset, true, 'Classic resetPomodoro cancels pending auto-start timer');

    // Reload Classic and verify Pomodoro running session restored
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && typeof restoreClassicPomodoro === "function" && typeof pomState !== "undefined"');
    await cdp.eval(`(async () => {
      if (typeof finishQuickStart === 'function') await finishQuickStart(true);
      if (typeof closeQuickStart === 'function') closeQuickStart();
      document.querySelectorAll('.modal-overlay.is-open').forEach((el) => el.classList.remove('is-open'));
    })()`);
    const classicAfterReload = await cdp.eval(`(() => ({
      running: Boolean(pomState.running),
      mode: pomState.mode,
      remaining: pomState.remaining,
      playIcon: document.getElementById('pomo-play-btn')?.textContent || '',
      focusTaskId,
    }))()`);
    assert.equal(classicAfterReload.running, true, 'Classic Pomodoro resumes running after reload');
    assert.equal(classicAfterReload.mode, 'focus', 'Classic Pomodoro preserves mode across reload');
    assert.ok(classicAfterReload.remaining > 0 && classicAfterReload.remaining <= 25 * 60, 'Classic Pomodoro preserves remaining seconds');
    assert.equal(classicAfterReload.playIcon, '\u23F8', 'Classic Pomodoro play button shows pause icon after reload');
    assert.equal(classicAfterReload.focusTaskId, 'c_overdue', 'Classic Pomodoro restores bound focusTaskId');
    await cdp.eval('resetPomodoro();');

    // Study Studio desktop/mobile tap targets & keyboard shortcut bindings
    const studyUiCheck = await cdp.eval(`(async () => {
      openStudyStudio();
      const starterH = document.querySelector('#nexos-study-modal .ns-starters button')?.getBoundingClientRect().height || 0;
      const backH = document.querySelector('#nexos-study-modal .ns-back')?.getBoundingClientRect().height || 0;
      NexStudy.close();
      return { starterH, backH };
    })()`);
    assert.ok(studyUiCheck.starterH > 0 && studyUiCheck.backH >= 36, 'Study Studio buttons render cleanly');

    // Classic responsive viewport audit: 1440x900, 768x1024, 360x740
    for (const vp of [
      { name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'tablet', width: 768, height: 1024, mobile: false },
      { name: 'mobile', width: 360, height: 740, mobile: true },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      await cdp.eval(`(() => {
        state.tasks = [{ id: 'vp_t1', title: 'Mobile Task Card', col: 'todo', priority: 'high', created: Date.now() }];
        state.habits = [{ id: 'vp_h1', name: 'Mobile Habit', color: '#0A84FF', checks: {}, goal: 7 }];
        renderDashboard();
        renderKanban();
        renderHabits();
      })()`);
      for (const view of ['dashboard', 'kanban', 'pomodoro', 'habits', 'notes', 'analytics']) {
        const vpRes = await cdp.eval(`(() => {
          const curView = ${JSON.stringify(view)};
          switchView(curView);
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const minTouch = (sel) => {
            const els = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
            return els.length ? Math.min(...els.map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))) : 999;
          };
          return {
            overflow,
            taskActMin: curView === 'kanban' ? minTouch('#kanban-board .task-action-btn, #kanban-board .task-move-btn') : 999,
            filterMin: curView === 'kanban' ? minTouch('#classic-kanban-filter-bar .filter-btn') : 999,
            habitMin: curView === 'habits' ? minTouch('#habits-grid .habit-edit-btn, #habits-grid .habit-delete-btn') : 999,
          };
        })()`);
        assert.ok(vpRes.overflow <= 1, `Classic ${vp.name}/${view} zero horizontal overflow (got ${vpRes.overflow})`);
        if (vp.name === 'mobile') {
          if (view === 'kanban') {
            assert.ok(vpRes.taskActMin >= 36, `Classic mobile Kanban action/move touch target >= 36px (got ${vpRes.taskActMin})`);
            assert.ok(vpRes.filterMin >= 36, `Classic mobile Kanban filter button >= 36px (got ${vpRes.filterMin})`);
          }
          if (view === 'habits') {
            assert.ok(vpRes.habitMin >= 36, `Classic mobile Habit edit/delete button >= 36px (got ${vpRes.habitMin})`);
          }
        }
      }
      if (vp.name === 'mobile') {
        const studyMob = await cdp.eval(`(() => {
          openStudyStudio();
          const starterH = document.querySelector('#nexos-study-modal .ns-starters button')?.getBoundingClientRect().height || 0;
          const backH = document.querySelector('#nexos-study-modal .ns-back')?.getBoundingClientRect().height || 0;
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          NexStudy.close();
          return { starterH, backH, overflow };
        })()`);
        assert.ok(studyMob.overflow <= 1, `Classic mobile Study Studio zero horizontal overflow (got ${studyMob.overflow})`);
        assert.ok(studyMob.starterH >= 36 && studyMob.backH >= 36, `Classic mobile Study Studio pill/back buttons >= 36px (${studyMob.starterH}, ${studyMob.backH})`);
      }
    }

    // ── 2. ENTERPRISE (/enterprise): Modals, Dashboard, Kanban #tags+Overdue, Pomodoro reload, Offline Analytics, All 5 Themes Contrast, Mobile/Tablet Breadcrumb & Touch ──
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${urlBase}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof switchNexusView === "function" && typeof applyNexusTheme === "function"');

    const dialogsBefore = cdp.dialogs.length;
    const entDesktop = await cdp.eval(`(async () => {
      const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDateKey(d); })();
      const nextWk = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return localDateKey(d); })();
      state.tasks = [
        { id: 'e_future_high', title: 'High future architecture review', priority: 'high', stage: 'todo', due: nextWk, tags: ['arch'], created: Date.now() },
        { id: 'e_overdue_low', title: 'Finance audit closeout', priority: 'low', stage: 'inprogress', due: yest, tags: ['finance'], created: Date.now() }
      ];
      state.habits = [
        { id: 'eh1', name: 'Deep Reading', color: '#34C759', streak: 0, checks: { [today()]: true, [yest]: true }, goal: 7 }
      ];
      renderAllViews();

      // Dashboard: overdue first, <button class="task-check-circle">, clickable priority opens editor modal, live NexHabits streak (!== '0d')
      const firstTitle = document.querySelector('#dash-priorities-list .dash-task-name')?.textContent?.trim() || '';
      const dashCheckTag = document.querySelector('#dash-priorities-list .task-check-circle')?.tagName || '';
      const dashHasOverdue = Boolean(document.querySelector('#dash-priorities-list .task-due-chip.overdue'));
      const dashStreakText = document.querySelector('#dash-habits-container .streak-pill')?.textContent?.trim() || '';
      const kpiTasksTrend = document.getElementById('kpi-tasks-trend')?.textContent?.trim() || '';

      document.querySelector('#dash-priorities-list .dash-task-main')?.click();
      const editorOpenedFromDash = document.getElementById('modal-task-editor')?.classList.contains('open') === true;
      closeModal('modal-task-editor');

      // Kanban: #finance tag search & Overdue filter pill
      switchNexusView('kanban');
      const kSearch = document.getElementById('kanban-search-input');
      kSearch.value = '#finance';
      filterKanbanSearch(kSearch.value);
      const tagMatchCount = document.querySelectorAll('#pane-kanban .task-card').length;
      kSearch.value = '';
      filterKanbanSearch('');
      filterKanbanPriority('overdue', document.querySelector('#pane-kanban .filter-btn[onclick*="overdue"]'));
      const overdueKanbanCount = document.querySelectorAll('#pane-kanban .task-card').length;
      filterKanbanPriority('all', document.querySelector('#pane-kanban .filter-btn'));

      // Calendar: scheduleTaskAtHour opens #modal-slot-schedule (NO window.prompt), picks existing task AND creates new task
      switchNexusView('calendar');
      scheduleTaskAtHour(10);
      const slotModalOpen = document.getElementById('modal-slot-schedule')?.classList.contains('open') === true;
      const existingPickBtns = document.querySelectorAll('#slot-existing-tasks .slot-task-pick-btn').length;
      document.querySelector('#slot-existing-tasks .slot-task-pick-btn')?.click();
      const assignedHour = state.tasks.find((t) => t.id === 'e_overdue_low')?.scheduledHour ?? state.tasks.find((t) => t.id === 'e_future_high')?.scheduledHour;
      scheduleTaskAtHour(14);
      document.getElementById('slot-new-task-title').value = 'New 14:00 Sprint Block';
      document.getElementById('slot-new-task-priority').value = 'high';
      submitSlotNewTask();
      const createdScheduledTask = state.tasks.find((t) => t.title === 'New 14:00 Sprint Block');

      // Habits: openNewHabitModal opens #modal-new-habit (NO window.prompt) with weekly goal = 4
      switchNexusView('habits');
      openNewHabitModal();
      const habitModalOpen = document.getElementById('modal-new-habit')?.classList.contains('open') === true;
      document.getElementById('new-habit-modal-name').value = 'Weekly Strength Training';
      document.getElementById('new-habit-modal-goal').value = '4';
      submitNewHabitModal();
      const createdHabit = state.habits.find((h) => h.name === 'Weekly Strength Training');

      // Analytics offline fallback & insights strip
      window.Chart = undefined;
      switchNexusView('analytics');
      const insightsText = document.getElementById('analytics-insights-strip')?.textContent?.trim() || '';
      const offlineChartCount = document.querySelectorAll('#pane-analytics .analytics-offline-box').length;

      // Focus: #cfg-long-min dynamic tab update + running session persisted for reload
      switchNexusView('focus');
      const longCfg = document.getElementById('cfg-long-min');
      longCfg.value = '20';
      updatePomoDurations();
      const longTabText = document.getElementById('tab-pomo-long')?.textContent?.trim() || '';
      setPomodoroMode('focus');
      focusOnTask('e_future_high');
      const entSavedRaw = localStorage.getItem('nexos_enterprise_pomo_v1');

      return {
        firstTitle,
        dashCheckTag,
        dashHasOverdue,
        dashStreakText,
        kpiTasksTrend,
        editorOpenedFromDash,
        tagMatchCount,
        overdueKanbanCount,
        slotModalOpen,
        existingPickBtns,
        assignedHour,
        createdScheduledHour: createdScheduledTask ? createdScheduledTask.scheduledHour : null,
        habitModalOpen,
        createdHabitGoal: createdHabit ? createdHabit.goal : null,
        insightsText,
        offlineChartCount,
        longTabText,
        entPomoRunning: state.pomoRunning,
        entSavedHasEndAt: Boolean(entSavedRaw && JSON.parse(entSavedRaw).endAt > Date.now()),
      };
    })()`);

    assert.equal(cdp.dialogs.length, dialogsBefore, 'Enterprise Calendar and Habits modals must never trigger native window.prompt');
    assert.equal(entDesktop.firstTitle, 'Finance audit closeout', 'Enterprise Dashboard sorts overdue task before non-overdue high priority');
    assert.equal(entDesktop.dashCheckTag, 'BUTTON', 'Enterprise Dashboard task check uses accessible <button>');
    assert.equal(entDesktop.dashHasOverdue, true, 'Enterprise Dashboard renders overdue badge');
    assert.equal(entDesktop.dashStreakText, '🔥 2d', 'Enterprise Dashboard computes live 2d streak via NexHabits even when h.streak===0');
    assert.ok(entDesktop.kpiTasksTrend.includes('overdue'), `Enterprise KPI tasks trend reflects real overdue count (${entDesktop.kpiTasksTrend})`);
    assert.equal(entDesktop.editorOpenedFromDash, true, 'Clicking Enterprise Dashboard priority task opens Task Editor modal');
    assert.equal(entDesktop.tagMatchCount, 1, 'Enterprise Kanban search finds #finance tag match');
    assert.equal(entDesktop.overdueKanbanCount, 1, 'Enterprise Kanban Overdue filter isolates overdue card');
    assert.equal(entDesktop.slotModalOpen, true, 'Enterprise scheduleTaskAtHour opens accessible #modal-slot-schedule');
    assert.ok(entDesktop.existingPickBtns >= 2, 'Enterprise slot modal lists existing open tasks');
    assert.equal(entDesktop.assignedHour, 10, 'Picking an existing task schedules it at 10:00');
    assert.equal(entDesktop.createdScheduledHour, 14, 'Creating a new slot task schedules it at 14:00');
    assert.equal(entDesktop.habitModalOpen, true, 'Enterprise openNewHabitModal opens accessible #modal-new-habit');
    assert.equal(entDesktop.createdHabitGoal, 4, 'Creating a habit via modal saves selected weekly goal');
    assert.ok(entDesktop.insightsText.includes('Overdue') && entDesktop.offlineChartCount >= 2, 'Enterprise Analytics shows insights strip and offline chart boxes');
    assert.equal(entDesktop.longTabText, 'Long Break (20m)', 'Changing #cfg-long-min updates #tab-pomo-long label dynamically');
    assert.equal(entDesktop.entPomoRunning, true, 'Enterprise focusOnTask starts focus timer');
    assert.equal(entDesktop.entSavedHasEndAt, true, 'Enterprise Pomodoro persists running endAt to localStorage');

    // Reload Enterprise and verify Pomodoro running session restored with bound task
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete" && typeof restoreEnterprisePomodoroSession === "function" && typeof state !== "undefined"');
    const entAfterReload = await cdp.eval(`(() => ({
      running: Boolean(state.pomoRunning),
      mode: state.pomoMode,
      remaining: state.pomoTimeRemaining,
      focusTaskId,
      longVal: document.getElementById('cfg-long-min')?.value || '',
    }))()`);
    assert.equal(entAfterReload.running, true, 'Enterprise Pomodoro resumes running after reload');
    assert.equal(entAfterReload.mode, 'focus', 'Enterprise Pomodoro preserves mode across reload');
    assert.ok(entAfterReload.remaining > 0 && entAfterReload.remaining <= 25 * 60, 'Enterprise Pomodoro preserves remaining seconds across reload');
    assert.equal(entAfterReload.focusTaskId, 'e_future_high', 'Enterprise Pomodoro preserves bound focusTaskId across reload');
    assert.equal(entAfterReload.longVal, '20', 'Enterprise Pomodoro restores Long Break duration across reload');
    await cdp.eval('resetPomodoro();');

    // Check WCAG contrast across all 5 Enterprise themes
    const contrastReport = await cdp.eval(`(() => {
      state.habits = [{ id: 'ch_ctr', name: 'Contrast Habit', color: '#34C759', checks: { [today()]: true }, goal: 7 }];
      const out = [];
      for (const t of ['apple-light', 'apple-dark', 'cyber-aubergine', 'cobalt-lime-dark', 'violet-orchid-dark']) {
        applyNexusTheme(t);
        renderAllViews();
        switchNexusView('habits');
        const kpi = document.getElementById('kpi-tasks-trend');
        const kpiCard = document.querySelector('.kpi-card');
        const chk = document.querySelector('.habit-day-check-btn.checked');
        const ks = kpi ? getComputedStyle(kpi) : null;
        const kcs = kpiCard ? getComputedStyle(kpiCard) : null;
        const cs = chk ? getComputedStyle(chk) : null;
        out.push({
          theme: t,
          kpiFg: ks ? ks.color : '',
          kpiBg: kcs ? kcs.backgroundColor : '',
          chkFg: cs ? cs.color : '',
          chkBg: cs ? cs.backgroundColor : '',
        });
      }
      applyNexusTheme('cyber-aubergine');
      return out;
    })()`);
    for (const row of contrastReport) {
      if (row.theme === 'apple-light') {
        const kpiRatio = contrastRatio(row.kpiFg, row.kpiBg);
        assert.ok(kpiRatio >= 4.5, `Enterprise apple-light .kpi-trend-positive contrast (${kpiRatio.toFixed(2)}) must be >= 4.5:1`);
      }
      const chkRatio = contrastRatio(row.chkFg, row.chkBg);
      assert.ok(chkRatio >= 4.0, `Enterprise ${row.theme} checked habit button contrast (${chkRatio.toFixed(2)}) must be >= 4.0:1`);
    }

    // Enterprise responsive viewport check: 1440x900, 768x1024, 360x740 (zero overflow, unclipped breadcrumb, >=36px mobile touch targets)
    for (const vp of [
      { name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'tablet', width: 768, height: 1024, mobile: false },
      { name: 'mobile', width: 360, height: 740, mobile: true },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      await cdp.eval(`(() => {
        state.tasks = [{ id: 'evp_t1', title: 'Responsive Ent Task', priority: 'high', stage: 'todo', created: Date.now() }];
        state.habits = [{ id: 'evp_h1', name: 'Responsive Ent Habit', color: '#0A84FF', checks: {}, goal: 7 }];
        renderAllViews();
      })()`);
      for (const pane of ['dashboard', 'kanban', 'calendar', 'focus', 'habits', 'notes', 'analytics', 'ai']) {
        const vpRes = await cdp.eval(`(() => {
          const curPane = ${JSON.stringify(pane)};
          switchNexusView(curPane);
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const titleEl = document.getElementById('topbar-view-title');
          const titleClipped = titleEl ? (titleEl.scrollWidth - titleEl.clientWidth > 2) : false;
          const minTouch = (sel) => {
            const els = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
            return els.length ? Math.min(...els.map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))) : 999;
          };
          return {
            overflow,
            titleClipped,
            titleText: titleEl ? titleEl.textContent.trim() : '',
            taskActMin: curPane === 'kanban' ? minTouch('#pane-kanban .task-action-icon-btn') : 999,
            filterMin: curPane === 'kanban' ? minTouch('#pane-kanban .filter-btn') : 999,
            promptMin: curPane === 'ai' ? minTouch('#pane-ai .prompt-chip-btn') : 999,
          };
        })()`);
        assert.ok(vpRes.overflow <= 1, `Enterprise ${vp.name}/${pane} zero horizontal overflow (got ${vpRes.overflow})`);
        assert.equal(vpRes.titleClipped, false, `Enterprise ${vp.name}/${pane} topbar breadcrumb title "${vpRes.titleText}" must not clip`);
        if (vp.name === 'mobile') {
          if (pane === 'kanban') {
            assert.ok(vpRes.taskActMin >= 36, `Enterprise mobile Kanban icon button >= 36px (got ${vpRes.taskActMin})`);
            assert.ok(vpRes.filterMin >= 36, `Enterprise mobile Kanban filter button >= 36px (got ${vpRes.filterMin})`);
          }
          if (pane === 'ai') {
            assert.ok(vpRes.promptMin >= 36, `Enterprise mobile NexAI prompt chip >= 36px (got ${vpRes.promptMin})`);
          }
        }
      }
    }

    assert.deepEqual(cdp.exceptions, [], 'Zero uncaught runtime exceptions during product polish suite');
    assert.deepEqual(cdp.consoleErrors, [], 'Zero console errors during product polish suite');
    console.log('NexOS 4.7.0 product polish, persistence, contrast & responsive Chrome CDP suite passed.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    await new Promise((r) => httpServer.close(r));
  }
})();
