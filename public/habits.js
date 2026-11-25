/* NexOS 4.2.0 — habit statistics, shared by Classic and Enterprise.
   Pure functions over a habit's `checks` map ({ "YYYY-MM-DD": true }) and an optional `goal` (days per week, 1 to 7, default 7).
   Daily habits (goal 7) count day streaks. Habits with a weekly goal count weeks in a row (Monday to Sunday) that reached the goal,
   so a "3 days a week" habit is not punished for rest days. Nothing here writes data: the stored `streak` field is left alone. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const dayNum = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : NaN;
  };
  const weekOf = (n) => Math.floor((n + 3) / 7); // Monday-based week index
  const goalOf = (h) => { const g = Math.round(Number(h && h.goal)); return g >= 1 && g <= 7 ? g : 7; };
  const GOAL_OPTIONS = [7, 6, 5, 4, 3, 2, 1].map((n) => ({ value: n, label: n === 7 ? 'Every day' : n + (n === 1 ? ' day a week' : ' days a week') }));

  function run(sortedNums) { // longest run of consecutive integers in an ascending, de-duplicated list
    let best = 0, cur = 0, prev = NaN;
    sortedNums.forEach((n) => { cur = n === prev + 1 ? cur + 1 : 1; if (cur > best) best = cur; prev = n; });
    return best;
  }

  function stats(habit, todayKey) {
    const today = dayNum(todayKey);
    const goal = goalOf(habit);
    const mode = goal === 7 ? 'day' : 'week';
    const checks = (habit && habit.checks && typeof habit.checks === 'object') ? habit.checks : {};
    const days = Object.keys(checks).filter((k) => checks[k]).map(dayNum).filter((n) => !isNaN(n) && n <= today).sort((a, b) => a - b);
    const set = new Set(days);
    const weekCounts = new Map();
    days.forEach((n) => weekCounts.set(weekOf(n), (weekCounts.get(weekOf(n)) || 0) + 1));
    const met = (w) => (weekCounts.get(w) || 0) >= goal;

    let current = 0, best = 0;
    if (mode === 'day') {
      let d = set.has(today) ? today : today - 1; // today not ticked yet: the streak is still alive from yesterday
      while (set.has(d)) { current++; d--; }
      best = run(days);
    } else {
      let w = weekOf(today);
      if (!met(w)) w--; // this week is still in progress
      while (met(w)) { current++; w--; }
      best = run([...weekCounts.keys()].filter(met).sort((a, b) => a - b));
    }
    best = Math.max(best, current);

    let rate30 = 0;
    if (days.length) {
      const span = Math.min(30, Math.max(7, today - days[0] + 1));
      const recent = days.filter((n) => n > today - span).length;
      const expected = mode === 'day' ? span : (goal * span) / 7;
      rate30 = Math.min(100, Math.round((recent / expected) * 100));
    }
    const marks = mode === 'day' ? [365, 200, 100, 60, 30, 14, 7] : [52, 26, 12, 4];
    const milestone = marks.find((t) => best >= t) || 0;
    return {
      mode, goal, current, best, rate30, total: days.length, doneToday: set.has(today),
      weekDone: weekCounts.get(weekOf(today)) || 0, milestone,
      lastDoneDaysAgo: days.length ? today - days[days.length - 1] : null
    };
  }

  function labels(st) {
    const unit = st.mode === 'day' ? 'day' : 'week';
    const streak = st.current > 0 ? `\uD83D\uDD25 ${st.current} ${unit} streak` : 'No streak yet';
    const best = st.best > 0 ? (st.current >= st.best && st.current >= 2 ? ' \u00B7 personal best \uD83C\uDFC6' : ` \u00B7 best ${st.best}`) : '';
    const week = st.mode === 'week' ? ` \u00B7 ${st.weekDone}/${st.goal} this week` : '';
    const meta = `${st.rate30}% last 30 days \u00B7 ${st.total} total${week}`;
    const milestone = st.milestone ? `\uD83C\uDFC5 ${st.milestone}-${unit} club` : '';
    const title = `Current streak: ${st.current} ${unit}${st.current === 1 ? '' : 's'}. Best streak: ${st.best}. Last 30 days: ${st.rate30}%. Total check-ins: ${st.total}.` + (st.mode === 'week' ? ` Goal: ${st.goal} days a week; ${st.weekDone} done this week.` : '');
    return { streak: streak + best, meta, milestone, title };
  }

  function summary(habits, todayKey) {
    const list = (Array.isArray(habits) ? habits : []).map((h) => stats(h, todayKey));
    const started = list.filter((s) => s.total > 0);
    return {
      active: list.length,
      doneToday: list.filter((s) => s.doneToday).length,
      bestCurrent: list.reduce((m, s) => Math.max(m, s.current), 0),
      rate30: started.length ? Math.round(started.reduce((a, s) => a + s.rate30, 0) / started.length) : 0,
      total: list.reduce((a, s) => a + s.total, 0)
    };
  }

  function summaryHtml(sum) {
    const card = (value, label) => `<div class="habit-stat"><b>${value}</b><span>${label}</span></div>`;
    return card(`${sum.doneToday}/${sum.active}`, 'Done today') + card(sum.bestCurrent, 'Longest current streak') + card(sum.rate30 + '%', 'Last 30 days') + card(sum.total, 'Total check-ins');
  }

  /* Keep the stats strip above the list in step with the habits (creates it on first use). */
  function renderSummary(habits, todayKey, anchor) {
    if (!anchor || !anchor.parentNode) return;
    let el = document.getElementById('habit-summary');
    if (!habits.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'habit-summary'; el.className = 'habit-summary'; anchor.parentNode.insertBefore(el, anchor); }
    el.innerHTML = summaryHtml(summary(habits, todayKey));
  }

  /* ---- 4.3.0: pause, reorder, per-habit heatmap and insights, reminder field ---- */
  const isActive = (h) => !(h && h.archived);
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const keyOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const safeColor = (c) => (/^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i.test(String(c || '')) ? c : '#4285F4');
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Move an active habit up (-1) or down (+1) past its neighbouring active habit. Paused habits keep their place. */
  function move(list, id, dir) {
    const i = list.findIndex((h) => h && String(h.id) === String(id));
    if (i < 0 || (dir !== -1 && dir !== 1)) return false;
    let j = i + dir;
    while (list[j] && !isActive(list[j])) j += dir;
    if (!list[j]) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
  }

  /* Last 12 weeks as a small grid (columns are weeks, rows Monday to Sunday, today's week last). */
  function heatmapHtml(habit, todayKey, color) {
    const today = dayNum(todayKey);
    if (isNaN(today)) return '';
    const checks = (habit && habit.checks && typeof habit.checks === 'object') ? habit.checks : {};
    const monday = today - ((today + 3) % 7);
    const first = monday - 11 * 7;
    const c = safeColor(color);
    let cells = '';
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        const n = first + w * 7 + d;
        const key = keyOf(n);
        if (n > today) cells += '<i class="hm-future"></i>';
        else if (checks[key]) cells += `<i class="hm-on" style="background:${c}" title="${key}"></i>`;
        else cells += `<i title="${key}"></i>`;
      }
    }
    return `<div class="habit-hm" role="img" aria-label="Check-ins over the last 12 weeks">${cells}</div>`;
  }

  /* Which weekday the habit is done most, how long ago it was last done, and when it started. */
  function insights(habit, todayKey) {
    const today = dayNum(todayKey);
    const checks = (habit && habit.checks && typeof habit.checks === 'object') ? habit.checks : {};
    const days = Object.keys(checks).filter((k) => checks[k]).map(dayNum).filter((n) => !isNaN(n) && n <= today).sort((a, b) => a - b);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    days.forEach((n) => { counts[(n + 3) % 7]++; });
    const top = Math.max(...counts);
    return {
      counts, bestWeekday: top > 0 && days.length >= 3 ? WEEKDAYS[counts.indexOf(top)] : '',
      lastDoneDaysAgo: days.length ? today - days[days.length - 1] : null,
      firstKey: days.length ? keyOf(days[0]) : ''
    };
  }

  function detailHtml(habit, todayKey, color) {
    const st = stats(habit, todayKey), ins = insights(habit, todayKey), L = labels(st);
    const ago = ins.lastDoneDaysAgo;
    const last = ago === null ? 'not yet' : ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago';
    const facts = [`Last done: ${last}`, ins.bestWeekday ? `Most often on ${ins.bestWeekday}s` : '', ins.firstKey ? `Started ${ins.firstKey}` : '', `Best streak ${st.best} ${st.mode === 'day' ? 'days' : 'weeks'}`, st.mode === 'week' ? `${st.weekDone}/${st.goal} this week` : '', habit.remindAt && TIME.test(habit.remindAt) ? `\uD83D\uDD14 Reminder ${habit.remindAt}` : '']
      .filter(Boolean).map((f) => `<span>${escHtml(f)}</span>`).join('');
    return `<div class="habit-detail"><div class="habit-detail-head"><b>Last 12 weeks</b><span>${escHtml(L.meta)}</span></div>${heatmapHtml(habit, todayKey, color)}<div class="habit-detail-facts">${facts}</div></div>`;
  }

  /* Extra controls for the edit bar: reminder time, move up/down, pause. Pages provide moveHabit() and archiveHabit(). */
  function editExtrasHtml(habit, o) {
    const id = escHtml(habit.id);
    const remind = TIME.test(String(habit.remindAt || '')) ? habit.remindAt : '';
    return `<label class="habit-edit-remind" title="Needs notifications turned on in Settings"><span>Remind at</span><input type="time" id="habit-edit-remind" class="${o.input}" value="${remind}" aria-label="Reminder time, leave empty for none"></label>`
      + `<span class="habit-edit-order"><button type="button" class="${o.btn}" onclick="moveHabit('${id}',-1)" aria-label="Move habit up">\u2191 Up</button><button type="button" class="${o.btn}" onclick="moveHabit('${id}',1)" aria-label="Move habit down">\u2193 Down</button></span>`
      + `<button type="button" class="${o.btn}" onclick="archiveHabit('${id}')" title="Hide it from your day without losing its history">Pause</button>`;
  }

  const api = { stats, labels, summary, summaryHtml, renderSummary, goalOf, GOAL_OPTIONS, dayNum, isActive, move, heatmapHtml, insights, detailHtml, editExtrasHtml, TIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexHabits = api;
  /* Pages draw habits on first load before this deferred script runs; redraw once so the stats appear. */
  if (typeof window !== 'undefined') window.addEventListener('load', () => { try { if (typeof window.renderHabits === 'function') window.renderHabits(); } catch (_) { /* page not ready yet */ } });
})(typeof window !== 'undefined' ? window : globalThis);
