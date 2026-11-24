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

  const api = { stats, labels, summary, summaryHtml, renderSummary, goalOf, GOAL_OPTIONS, dayNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexHabits = api;
  /* Pages draw habits on first load before this deferred script runs; redraw once so the stats appear. */
  if (typeof window !== 'undefined') window.addEventListener('load', () => { try { if (typeof window.renderHabits === 'function') window.renderHabits(); } catch (_) { /* page not ready yet */ } });
})(typeof window !== 'undefined' ? window : globalThis);
