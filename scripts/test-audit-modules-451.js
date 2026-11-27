'use strict';
// NexOS 4.5.1: Regression and cross-module integration tests for the 9-module audit
// (Modules 1-7 + cross-module bridge + release metadata alignment).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'Missing marker: ' + startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, 'Missing end marker: ' + endMarker);
  return src.slice(start, end);
}

(() => {
  const classicJs = read('public/app.js');
  const entHtml = read('public/index-redesign.html');
  const classicHtml = read('public/index.html');
  const swJs = read('public/sw.js');
  const compose = read('docker-compose.yml');
  const pkg = JSON.parse(read('package.json'));

  // 1) Module 1 & Bridge: setEnterpriseTaskStage & scheduledHour preservation across mappers
  {
    const bridgeCode = extractSlice(entHtml, 'function safeEnterpriseStage(value)', 'function enterpriseLocalKey()');
    const stageCode = extractSlice(entHtml, 'function setEnterpriseTaskStage(', 'function moveTaskStage(');
    let saved = 0, kanban = 0, dash = 0, cal = 0, kpi = 0;
    const ctx = vm.createContext({
      uid: () => 'id_test_1',
      today: () => '2026-11-25',
      escapeHtml: (s) => String(s || ''),
      saveWorkspaceState: () => saved++,
      renderKanban: () => kanban++,
      renderDashboard: () => dash++,
      renderCalendarTimeline: () => cal++,
      updateKPICounters: () => kpi++,
      renderFocusTask: () => {},
      state: { tasks: [] },
    });
    vm.runInContext(bridgeCode + '\n' + stageCode, ctx);

    const task = { id: 't1', title: 'Exam prep', stage: 'todo', priority: 'high', scheduledHour: 15 };
    ctx.setEnterpriseTaskStage(task, 'done');
    assert.equal(task.stage, 'done');
    assert.ok(Number.isFinite(task.doneAt), 'moving to done sets doneAt');
    ctx.setEnterpriseTaskStage(task, 'inprogress');
    assert.equal(task.stage, 'inprogress');
    assert.equal(task.doneAt, undefined, 'reopening clears doneAt');

    const backToClassic = ctx.mapEnterpriseTaskToClassic(task);
    assert.equal(backToClassic.col, 'inprogress');
    assert.equal(backToClassic.scheduledHour, 15, 'Enterprise->Classic preserves scheduledHour');
    const backToEnt = ctx.mapClassicTaskToEnterprise(backToClassic);
    assert.equal(backToEnt.stage, 'inprogress');
    assert.equal(backToEnt.scheduledHour, 15, 'Classic->Enterprise preserves scheduledHour');

    const addTaskCode = extractSlice(classicJs, 'function addTask()', 'function renderKanban()');
    const addCtx = vm.createContext({
      document: {
        getElementById: (id) => id === 'new-task-input'
          ? { value: '  ' + 'A'.repeat(200) + '  ', focus() {} }
          : { value: 'high' },
      },
      uid: () => 't_cap_1',
      state: { tasks: [] },
      saveState: () => {},
      renderKanban: () => {},
      renderDashboard: () => {},
      updateStats: () => {},
      updateContextPanel: () => {},
      checkDueNotifications: () => {},
    });
    vm.runInContext(addTaskCode, addCtx);
    addCtx.addTask();
    assert.equal(addCtx.state.tasks.length, 1);
    assert.equal(addCtx.state.tasks[0].title.length, 160, 'Classic addTask trims and caps title length at 160');
    assert.ok(entHtml.includes("saveTaskModal") && entHtml.includes("delete task.sample"), 'Enterprise saveTaskModal removes sample flag on edit');
  }

  // 2) Module 2: Deep Focus — skipPomodoro must NOT credit fake focus minutes or sessions
  {
    const skipCode = extractSlice(entHtml, 'function skipPomodoro()', 'function completePomodoroInterval()');
    let switched = 0;
    const ctx = vm.createContext({
      state: {
        pomoRunning: false,
        pomoMode: 'focus',
        pomodoroLog: [],
        pomodoroStats: { totalSessions: 0, totalMins: 0 },
      },
      pausePomodoro: () => {},
      setPomodoroMode: () => switched++,
      showToast: () => {},
    });
    vm.runInContext(skipCode, ctx);
    ctx.skipPomodoro();
    assert.equal(switched, 1, 'skip switches timer phase');
    assert.equal(ctx.state.pomodoroStats.totalSessions, 0, 'skip does not log fake completed session');
    assert.equal(ctx.state.pomodoroStats.totalMins, 0, 'skip does not log fake focus minutes');
    assert.equal(ctx.state.pomodoroLog.length, 0, 'skip leaves pomodoroLog untouched');

    assert.ok(classicJs.includes('let pomAudioCtx = null;'), 'Classic reuses single AudioContext');
    assert.ok(entHtml.includes("clampMin('cfg-focus-min', 25, 1, 120)") && entHtml.includes("clampMin('cfg-short-min', 5, 1, 60)"), 'Enterprise timer clamps focus/short durations');
  }

  // 3) Module 3: Habits — empty/whitespace rejection, key cleanup, missing checks guard
  {
    assert.ok(classicJs.includes('delete habit.checks[d]') && entHtml.includes('delete habit.checks[dateStr]'), 'Both UIs delete unchecked habit keys instead of storing false bloat');
    assert.ok(classicJs.includes('h && h.checks && h.checks[key]'), 'Classic heatmap safely guards missing checks object');
    assert.ok(entHtml.includes("habitDetailId === id) habitDetailId = null") && entHtml.includes("cleanName = String(raw).trim().slice(0, 80)"), 'Enterprise resets habitDetailId on delete and trims/caps habit names');
  }

  // 4) Module 4: Smart Notes — unsaved protection, tag search, Delete + Pin parity
  {
    assert.ok(classicJs.includes("(n.content || '').slice(0, 80)"), 'Classic note list guards undefined content');
    assert.ok(entHtml.includes('function flushEnterpriseNoteEdits') && entHtml.includes('noteEditorLoadedId !== current.id || !enterpriseNoteDirty'), 'Enterprise protects unsaved note edits across search and note switches');
    assert.ok(entHtml.includes('function togglePinActiveNote()') && entHtml.includes('function deleteActiveNote()'), 'Enterprise exposes Pin and Delete controls with undo');
    assert.ok(entHtml.includes("Array.isArray(n.tags) ? n.tags.join(' ').toLowerCase().includes(q) : false"), 'Enterprise notes search matches tags as advertised');
  }

  // 5) Module 5: Timeblocking / Calendar — single-digit clock parsing & Enterprise time slot persistence
  {
    const clockHelpers = extractSlice(classicJs, 'function clockMinutes(', 'function openPlanModal()');
    const ctx = vm.createContext({});
    vm.runInContext(clockHelpers, ctx);
    assert.equal(ctx.isValidClockTime('9:00'), true, 'accepts single-digit AI schedule hours');
    assert.equal(ctx.isValidClockTime('23:59'), true);
    assert.equal(ctx.isValidClockTime('24:00'), false);
    assert.equal(ctx.parseTimeMinutes('9:30'), 570);
    assert.ok(entHtml.includes('scheduledHour: hr') && entHtml.includes('function clearTaskScheduledHour') && entHtml.includes('function applyAutoSchedule'), 'Enterprise calendar persists scheduledHour and applies schedule');
  }

  // 6) Module 6: Analytics — CDN retry reset, 7/30 day toggle, data-driven hourly heatmap
  {
    assert.ok(classicJs.includes('classicChartLoadPromise = null; resolve(false)') && entHtml.includes('enterpriseChartLoadPromise = null; resolve(false)'), 'Both UIs reset Chart.js loader promise on error so retries work');
    assert.ok(entHtml.includes('function setAnalyticsRange(days, btn)'), 'Enterprise 7/30 day filter buttons are interactive');
    const heatCode = extractSlice(entHtml, 'function renderHourlyProductivityHeat()', 'function saveWeeklyReviewToNotes()');
    const slots = [];
    const ctx = vm.createContext({
      document: {
        getElementById: () => ({ innerHTML: '', appendChild: (s) => slots.push(s) }),
        createElement: () => ({ className: '', title: '', innerHTML: '' }),
      },
      state: {
        tasks: [
          { stage: 'done', doneAt: new Date(2026, 10, 25, 16, 15).getTime() },
          { stage: 'todo', scheduledHour: 16 },
        ],
      },
    });
    vm.runInContext(heatCode, ctx);
    ctx.renderHourlyProductivityHeat();
    assert.equal(slots.length, 13, 'renders 8h..20h strip');
    const slot9 = slots.find((s) => s.innerHTML.includes('>9h<'));
    const slot16 = slots.find((s) => s.innerHTML.includes('>16h<'));
    assert.ok(slot9.innerHTML.includes('Idle') && !slot9.className.includes('active'), '9h is NOT hardcoded Peak when empty');
    assert.ok(slot16.innerHTML.includes('Peak') && slot16.className.includes('active'), '16h reflects real completed/scheduled peak activity');
  }

  // 7) Module 7 & Phase 5/6: Dashboard KPI safety, priority ordering & version parity
  {
    assert.ok(entHtml.includes('refreshDailyInsight') && entHtml.includes("nexLocalInsight(state, today(), focusCfgMins)"), 'Enterprise dashboard insight delegates to nexLocalInsight');
    assert.ok(classicJs.includes("const cleanOpts = (opts && typeof opts === 'object' && typeof opts.tab === 'string')") && entHtml.includes("const cleanOpts = (opts && typeof opts === 'object' && typeof opts.tab === 'string')"), 'openStudyStudio filters raw click events cleanly');
    assert.equal(pkg.version, '4.6.0');
    assert.ok(compose.includes('com.nexos.version=4.6.0'), 'docker-compose label matches 4.6.0');
    assert.ok(swJs.includes('?v=4.6.0') && classicHtml.includes('?v=4.6.0') && entHtml.includes('?v=4.6.0'), 'PWA cache and HTML asset versions align on 4.6.0');
  }

  console.log('NexOS 4.5.1 9-module audit & cross-module regression tests passed.');
})();
