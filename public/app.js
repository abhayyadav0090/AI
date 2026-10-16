/* ═══════════════════════════════════════════════════════
   NexOS — Complete App Logic
   Modules: State, Kanban, Pomodoro, Habits, Notes, Analytics, NexAI
═══════════════════════════════════════════════════════ */

// ═══════════════════════════ STATE ═══════════════════════════
const STATE_KEY = 'nexos_v2';
let state = {
  tasks: [],
  habits: [],
  notes: [],
  pomodoroLog: [], // [{date, minutes}]
  pomodoroStats: { totalToday: 0, sessionsToday: 0, longestStreak: 0, lastDate: '' },
  theme: 'dark',
  currentNoteId: null,
  seeded: false,    // starter data has been offered once (so deleted samples never come back)
  hideGuide: false, // "Getting started" card dismissed
  usedAI: false,
};

let currentUser = null;
let saveTimer = null;

// Load this user's data from MongoDB (via the server)
async function loadState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('status ' + res.status);
    const { state: saved } = await res.json();
    if (saved) {
      state = { ...state, ...saved };
    } else {
      // First login: bring over any data saved in this browser before accounts existed
      const old = localStorage.getItem(STATE_KEY);
      if (old) {
        state = { ...state, ...JSON.parse(old) };
        await pushState();
        localStorage.removeItem(STATE_KEY);
      }
    }
  } catch (e) { console.warn('State load failed', e); }
}

// Same name as before, so every existing saveState() call keeps working.
// It waits 600ms after the last change, then sends everything to the server.
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushState, 600);
}

async function pushState() {
  if (!currentUser) return;
  try {
    const body = JSON.stringify({ state });
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60000, // lets the save finish if the tab is closing
    });
  } catch (e) { console.warn('State save failed', e); }
}

// Save right away if the user switches tab or closes the page
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    pushState();
  }
});

// ═══════════════════════════ AUTH ═══════════════════════════
async function checkLogin() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

function waitForGoogle() {
  return new Promise(resolve => {
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(t);
        resolve();
      }
    }, 100);
  });
}

async function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const errEl = document.getElementById('login-error');
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.googleClientId) { errEl.textContent = 'Google client ID is not configured on the server.'; return; }
    await waitForGoogle();
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: handleGoogleLogin });
    google.accounts.id.renderButton(document.getElementById('google-btn'), {
      theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill',
    });
  } catch (e) { errEl.textContent = 'Could not load Google sign-in.'; }
}

async function handleGoogleLogin(response) {
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    if (!res.ok) throw new Error('login failed');
    startApp(await res.json());
  } catch (e) { errEl.textContent = 'Sign-in failed. Please try again.'; }
}

async function logout() {
  await pushState();
  await fetch('/api/auth/logout', { method: 'POST' });
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  location.reload();
}

function showUser(user) {
  document.getElementById('user-name').textContent = user.name || 'You';
  const av = document.getElementById('user-avatar');
  if (user.picture) {
    const img = document.createElement('img');
    img.src = user.picture;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    av.textContent = '';
    av.appendChild(img);
  } else {
    av.textContent = (user.name || 'U')[0].toUpperCase();
  }
}

// ═══════════════════════════ INIT ═══════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkLogin();
  if (user) startApp(user);
  else showLogin();
});

async function startApp(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  showUser(user);
  await loadState();
  // Starter data is offered only once per account. If the user deletes it, it stays deleted.
  if (!state.seeded) {
    if (!state.tasks.length && !state.habits.length && !state.notes.length) seedStarter();
    state.seeded = true;
    saveState();
  }
  applyTheme();
  startClock();
  setGreeting();
  renderDashboard();
  renderKanban();
  renderHabits();
  renderNotes();
  renderAnalytics();
  updateContextPanel();
  initChat(); // loads saved chats in the background
}

// Small starter set that explains the app. Every item is flagged `sample: true`
// so "Clear sample data" can remove them without touching the user's own items.
function seedStarter() {
  const now = Date.now();
  state.tasks = [
    { id: uid(), sample: true, title: 'Add your first task', col: 'todo', priority: 'medium', desc: 'Type a title at the top of this page and press Add.', due: '', created: now },
    { id: uid(), sample: true, title: 'Start a 25-minute focus session', col: 'todo', priority: 'high', desc: 'Open Focus Timer and press play.', due: '', created: now },
    { id: uid(), sample: true, title: 'Drag this card to Done', col: 'inprogress', priority: 'low', desc: 'Drag cards between columns to track progress.', due: '', created: now },
  ];
  state.habits = [
    { id: uid(), sample: true, name: 'Drink water', color: '#06b6d4', checks: {}, streak: 0 },
    { id: uid(), sample: true, name: 'Read for 10 minutes', color: '#a78bfa', checks: {}, streak: 0 },
  ];
  state.notes = [
    { id: uid(), sample: true, title: 'Welcome to NexOS', content: 'A quick tour:\n\n- Kanban: plan tasks and drag cards across columns.\n- Focus Timer: work in 25-minute sessions.\n- Habits: tick habits every day to build streaks.\n- Notes: like this one. Edit or delete it any time.\n- NexAI: ask for a plan, priorities or a summary. Your chats are saved.\n\nThe sample tasks, habits and notes can be removed with "Clear sample data" on the Dashboard.', tags: ['welcome'], pinned: true, created: now },
  ];
}

// Items from the first version of NexOS had no `sample` flag, so match them by their old titles.
const LEGACY_SAMPLES = {
  tasks: ['Set up NexOS workspace', 'Plan weekly goals', 'Complete morning routine', 'Deep work session (2h)', 'Review and reflect'],
  habits: ['Morning meditation', 'Exercise 30 min', 'Read 20 pages', 'No social media before noon'],
  notes: ['Productivity Tips'],
};
const isSampleTask  = t => !!t.sample || LEGACY_SAMPLES.tasks.includes(t.title);
const isSampleHabit = h => !!h.sample || LEGACY_SAMPLES.habits.includes(h.name);
const isSampleNote  = n => !!n.sample || LEGACY_SAMPLES.notes.includes(n.title) || (n.title || '').startsWith('Welcome to NexOS');

function clearSampleData() {
  if (!confirm('Remove the sample tasks, habits and notes? Anything you created yourself stays.')) return;
  state.tasks = state.tasks.filter(t => !isSampleTask(t));
  state.habits = state.habits.filter(h => !isSampleHabit(h));
  state.notes = state.notes.filter(n => !isSampleNote(n));
  if (!state.notes.some(n => n.id === state.currentNoteId)) state.currentNoteId = null;
  saveState();
  renderDashboard(); renderKanban(); renderHabits(); renderNotes(); renderAnalytics(); updateContextPanel();
}

function hideGuide() { state.hideGuide = true; saveState(); renderGuide(); }

// "Getting started" checklist on the Dashboard. Steps tick themselves as the user does them.
function renderGuide() {
  const el = document.getElementById('guide-card');
  if (!el) return;
  if (state.hideGuide) { el.style.display = 'none'; return; }
  const steps = [
    { label: 'Add your first task',     view: 'kanban',   done: state.tasks.some(t => !isSampleTask(t)) },
    { label: 'Finish a focus session',  view: 'pomodoro', done: state.pomodoroLog.length > 0 },
    { label: 'Check off a habit',       view: 'habits',   done: state.habits.some(h => Object.values(h.checks || {}).some(Boolean)) },
    { label: 'Write your own note',     view: 'notes',    done: state.notes.some(n => !isSampleNote(n)) },
    { label: 'Ask NexAI something',     view: 'ai',       done: !!state.usedAI || chatList.length > 0 },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const hasSamples = state.tasks.some(isSampleTask) || state.habits.some(isSampleHabit) || state.notes.some(isSampleNote);
  el.innerHTML = `
    <div class="guide-head">
      <div>
        <div class="guide-title">${doneCount === steps.length ? 'You are all set \u{1F389}' : 'Getting started'}</div>
        <div class="guide-sub">${doneCount} of ${steps.length} done</div>
      </div>
      <div class="guide-actions">
        ${hasSamples ? '<button class="btn-sm" onclick="clearSampleData()">Clear sample data</button>' : ''}
        <button class="btn-sm" onclick="hideGuide()">Hide</button>
      </div>
    </div>
    <div class="guide-steps">
      ${steps.map(s => `
        <div class="guide-step ${s.done ? 'done' : ''}" onclick="switchView('${s.view}')">
          <span class="guide-check">${s.done ? '\u2713' : ''}</span>
          <span>${s.label}</span>
        </div>`).join('')}
    </div>`;
  el.style.display = '';
}

// ═══════════════════════════ UTILS ═══════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
// Local calendar date as YYYY-MM-DD (the old code used UTC, so the day changed at 5:30 AM in India).
function dateKey(d) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().split('T')[0];
}
function today() { return dateKey(new Date()); }
function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso); // plain dates are local, not UTC
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function dayKey(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return dateKey(d);
}

// ═══════════════════════════ CLOCK + GREETING ═══════════════════════════
function startClock() {
  const tick = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('topbar-clock');
    if (el) el.textContent = `${h}:${m}:${s}`;
  };
  tick(); setInterval(tick, 1000);
}

function setGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const el = document.getElementById('greeting-time');
  if (el) el.textContent = greet;
  const dateEl = document.getElementById('dashboard-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ═══════════════════════════ THEME ═══════════════════════════
function applyTheme() {
  if (state.theme === 'light') document.body.classList.add('light-theme');
  else document.body.classList.remove('light-theme');
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); saveState();
}

// ═══════════════════════════ VIEW SWITCHING ═══════════════════════════
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const navItem = document.querySelector(`[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');
  const breadcrumb = document.getElementById('breadcrumb');
  const labels = { dashboard: 'Dashboard', kanban: 'Kanban Board', pomodoro: 'Focus Timer', habits: 'Habit Tracker', notes: 'Smart Notes', analytics: 'Analytics', ai: 'NexAI' };
  if (breadcrumb) breadcrumb.textContent = labels[name] || name;
  if (name === 'dashboard') { renderDashboard(); updateStats(); }
  if (name === 'analytics') renderAnalytics();
  if (name === 'ai') updateContextPanel();
  // close sidebar on mobile
  if (window.innerWidth < 900) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ═══════════════════════════ DASHBOARD ═══════════════════════════
function renderDashboard() {
  updateStats();
  renderGuide();
  // Tasks
  const taskList = document.getElementById('dash-tasks-list');
  const priorityTasks = state.tasks.filter(t => t.col !== 'done').slice(0, 5);
  if (priorityTasks.length) {
    taskList.innerHTML = priorityTasks.map(t => `
      <div class="dash-task-item priority-${t.priority}" onclick="switchView('kanban')">
        <span style="font-size:10px;color:var(--text-muted)">${t.col.toUpperCase()}</span>
        <span style="flex:1">${escHtml(t.title)}</span>
        ${t.due ? `<span style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted)">${fmtDate(t.due)}</span>` : ''}
      </div>`).join('');
  } else {
    taskList.innerHTML = '<div class="empty-state">No active tasks. Add some in Kanban!</div>';
  }
  // Habits
  const habitList = document.getElementById('dash-habits-list');
  if (state.habits.length) {
    habitList.innerHTML = state.habits.slice(0, 4).map(h => {
      const done = h.checks[today()];
      return `<div class="dash-habit-item">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:${h.color};flex-shrink:0"></div>
          <span style="font-size:13px;color:${done ? 'var(--accent-emerald)' : 'var(--text-secondary)'}">${escHtml(h.name)}</span>
        </div>
        <span class="habit-streak-badge">${done ? '✓' : ''} ${h.streak}🔥</span>
      </div>`;
    }).join('');
  } else {
    habitList.innerHTML = '<div class="empty-state">No habits tracked yet.</div>';
  }
  // Notes
  const notesList = document.getElementById('dash-notes-list');
  const recentNotes = [...state.notes].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 4);
  if (recentNotes.length) {
    notesList.innerHTML = recentNotes.map(n => `
      <div class="dash-note-item" onclick="openNoteFromDash('${n.id}')">
        <div class="dash-note-title">${n.pinned ? '📌 ' : ''}${escHtml(n.title)}</div>
        <div class="dash-note-preview">${escHtml(n.content.slice(0, 80))}</div>
      </div>`).join('');
  } else {
    notesList.innerHTML = '<div class="empty-state">No notes yet.</div>';
  }
}

function openNoteFromDash(id) {
  switchView('notes');
  setTimeout(() => openNote(id), 100);
}

function updateStats() {
  const activeTasks = state.tasks.filter(t => t.col !== 'done').length;
  document.getElementById('stat-tasks-val').textContent = activeTasks;
  // Focus time today
  const todayLog = state.pomodoroLog.filter(l => l.date === today());
  const focusMins = todayLog.reduce((s, l) => s + l.minutes, 0);
  document.getElementById('stat-focus-val').textContent = focusMins + 'm';
  // Habits today
  const doneHabits = state.habits.filter(h => h.checks[today()]).length;
  const pct = state.habits.length ? Math.round((doneHabits / state.habits.length) * 100) : 0;
  document.getElementById('stat-habits-val').textContent = pct + '%';
  // Notes
  document.getElementById('stat-notes-val').textContent = state.notes.length;
}

// ═══════════════════════════ KANBAN ═══════════════════════════
let dragId = null;

function addTask() {
  const input = document.getElementById('new-task-input');
  const priority = document.getElementById('new-task-priority').value;
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const task = { id: uid(), title, col: 'todo', priority, desc: '', due: '', created: Date.now() };
  state.tasks.push(task);
  input.value = '';
  saveState();
  renderKanban();
  updateStats();
}

function renderKanban() {
  const cols = ['todo', 'inprogress', 'review', 'done'];
  cols.forEach(col => {
    const container = document.getElementById('col-' + col);
    const count = document.getElementById('count-' + col);
    const tasks = state.tasks.filter(t => t.col === col);
    if (count) count.textContent = tasks.length;
    if (container) {
      container.innerHTML = tasks.map(t => `
        <div class="task-card" draggable="true" id="task-${t.id}"
          ondragstart="dragStart('${t.id}')" ondragend="dragEnd()"
          ondragover="event.preventDefault()" ondrop="dropOnCard(event,'${t.id}')">
          <div class="task-card-title">${escHtml(t.title)}</div>
          ${t.desc ? `<div class="task-desc">${escHtml(t.desc.slice(0, 80))}</div>` : ''}
          <div class="task-card-meta">
            <span class="priority-chip priority-${t.priority}">${t.priority}</span>
            ${t.due ? `<span class="task-due">${fmtDate(t.due)}</span>` : ''}
            <div class="task-card-actions">
              <button class="task-action-btn" onclick="openTaskModal('${t.id}')" title="Edit">✎</button>
              <button class="task-action-btn" onclick="deleteTask('${t.id}')" title="Delete">✕</button>
            </div>
          </div>
        </div>`).join('') || `<div style="height:40px"></div>`;
    }
  });
}

function dragStart(id) {
  dragId = id;
  setTimeout(() => { const el = document.getElementById('task-' + id); if (el) el.classList.add('dragging'); }, 0);
}
function dragEnd() {
  if (dragId) { const el = document.getElementById('task-' + dragId); if (el) el.classList.remove('dragging'); }
}
// Moves a task to a column and remembers when it was completed (used by the Analytics chart).
function setTaskCol(task, col) {
  if (task.col === col) return;
  task.col = col;
  if (col === 'done') task.doneAt = Date.now(); else delete task.doneAt;
}

function dropTask(e, col) {
  e.preventDefault();
  if (!dragId) return;
  const task = state.tasks.find(t => t.id === dragId);
  if (task) { setTaskCol(task, col); saveState(); renderKanban(); updateStats(); }
  dragId = null;
  document.querySelectorAll('.col-cards').forEach(c => c.classList.remove('drag-over'));
}
function dropOnCard(e, targetId) {
  e.preventDefault(); e.stopPropagation();
  if (!dragId || dragId === targetId) return;
  const target = state.tasks.find(t => t.id === targetId);
  const source = state.tasks.find(t => t.id === dragId);
  if (target && source) { setTaskCol(source, target.col); saveState(); renderKanban(); updateStats(); }
  dragId = null;
}
document.addEventListener('dragover', e => {
  const col = e.target.closest('.col-cards');
  document.querySelectorAll('.col-cards').forEach(c => c.classList.remove('drag-over'));
  if (col) col.classList.add('drag-over');
});

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState(); renderKanban(); updateStats();
}

// Task Modal
let editingTaskId = null;
function openTaskModal(id) {
  editingTaskId = id;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('modal-task-title').textContent = 'Edit Task';
  document.getElementById('modal-title-input').value = task.title;
  document.getElementById('modal-desc-input').value = task.desc || '';
  document.getElementById('modal-priority-input').value = task.priority;
  document.getElementById('modal-due-input').value = task.due || '';
  document.getElementById('task-modal').classList.add('is-open');
}
function closeTaskModal(e) {
  if (!e || e.target.id === 'task-modal' || e.target.closest('.modal-close')) {
    document.getElementById('task-modal').classList.remove('is-open');
    editingTaskId = null;
  }
}
function saveTaskModal() {
  if (!editingTaskId) return;
  const task = state.tasks.find(t => t.id === editingTaskId);
  if (!task) return;
  delete task.sample; // edited by the user, so it is no longer a sample
  task.title = document.getElementById('modal-title-input').value.trim() || task.title;
  task.desc = document.getElementById('modal-desc-input').value;
  task.priority = document.getElementById('modal-priority-input').value;
  task.due = document.getElementById('modal-due-input').value;
  saveState(); renderKanban();
  document.getElementById('task-modal').classList.remove('is-open');
}
async function aiSuggestTask() {
  const titleInput = document.getElementById('modal-title-input');
  const title = titleInput.value.trim();
  if (!title) { titleInput.placeholder = 'Enter a task title first…'; return; }
  const descInput = document.getElementById('modal-desc-input');
  descInput.value = 'AI is generating a description…';
  try {
    const res = await callAI(`For the task "${title}", write a concise 1-2 sentence actionable description and suggest a priority (low/medium/high). Format: DESCRIPTION: ... | PRIORITY: ...`);
    const match = res.match(/DESCRIPTION:\s*(.+?)\s*\|\s*PRIORITY:\s*(low|medium|high)/i);
    if (match) {
      descInput.value = match[1];
      document.getElementById('modal-priority-input').value = match[2].toLowerCase();
    } else { descInput.value = res.slice(0, 200); }
  } catch (e) { descInput.value = 'Could not generate suggestion.'; }
}

// ═══════════════════════════ POMODORO ═══════════════════════════
let pomTimer = null;
let pomState = { mode: 'focus', remaining: 25 * 60, running: false, sessionCount: 0 };
const pomDurations = { focus: 25, short: 5, long: 15 };

function setMode(mode) {
  if (pomState.running) return;
  pomState.mode = mode;
  pomState.remaining = (pomDurations[mode] || 25) * 60;
  updateDurations();
  document.querySelectorAll('.pomo-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + mode)?.classList.add('active');
  renderPomTimer();
}

function updateDurations() {
  pomDurations.focus = parseInt(document.getElementById('focus-duration')?.value || 25);
  pomDurations.short = parseInt(document.getElementById('short-duration')?.value || 5);
  pomDurations.long = parseInt(document.getElementById('long-duration')?.value || 15);
  if (!pomState.running) {
    pomState.remaining = pomDurations[pomState.mode] * 60;
    renderPomTimer();
  }
}

function togglePomodoro() {
  pomState.running = !pomState.running;
  const btn = document.getElementById('pomo-play-btn');
  const miniBtn = document.getElementById('mini-play-btn');
  if (pomState.running) {
    if (btn) btn.textContent = '⏸';
    if (miniBtn) miniBtn.textContent = '⏸';
    pomTimer = setInterval(pomTick, 1000);
  } else {
    if (btn) btn.textContent = '▶';
    if (miniBtn) miniBtn.textContent = '▶';
    clearInterval(pomTimer);
  }
}

function togglePomodoroFromDash() { togglePomodoro(); }

function pomTick() {
  if (pomState.remaining > 0) {
    pomState.remaining--;
    renderPomTimer();
  } else {
    clearInterval(pomTimer);
    pomState.running = false;
    pomSessionComplete();
  }
}

function pomSessionComplete() {
  const btn = document.getElementById('pomo-play-btn');
  const miniBtn = document.getElementById('mini-play-btn');
  if (btn) btn.textContent = '▶';
  if (miniBtn) miniBtn.textContent = '▶';
  if (pomState.mode === 'focus') {
    const mins = pomDurations.focus;
    state.pomodoroLog.push({ date: today(), minutes: mins });
    state.pomodoroStats.sessionsToday = (state.pomodoroStats.sessionsToday || 0) + 1;
    state.pomodoroStats.totalToday = (state.pomodoroStats.totalToday || 0) + mins;
    pomState.sessionCount++;
    if (pomState.sessionCount >= (state.pomodoroStats.longestStreak || 0)) {
      state.pomodoroStats.longestStreak = pomState.sessionCount;
    }
    saveState(); updateStats();
    // Play sound
    if (document.getElementById('sound-enabled')?.checked) playBeep();
    // Auto-start break
    if (document.getElementById('auto-start')?.checked) {
      const nextMode = pomState.sessionCount % 4 === 0 ? 'long' : 'short';
      setMode(nextMode);
      setTimeout(togglePomodoro, 1000);
    }
  } else {
    if (document.getElementById('auto-start')?.checked) {
      setMode('focus'); setTimeout(togglePomodoro, 1000);
    }
  }
  renderPomoStats();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}

function resetPomodoro() {
  clearInterval(pomTimer); pomState.running = false;
  pomState.remaining = pomDurations[pomState.mode] * 60;
  document.getElementById('pomo-play-btn').textContent = '▶';
  document.getElementById('mini-play-btn').textContent = '▶';
  renderPomTimer();
}

function skipPomodoro() { pomSessionComplete(); resetPomodoro(); }

function renderPomTimer() {
  const total = pomDurations[pomState.mode] * 60;
  const pct = pomState.remaining / total;
  const circum = 879;
  const offset = circum * (1 - pct);
  const ring = document.getElementById('pomo-ring-progress');
  if (ring) ring.style.strokeDashoffset = offset;
  const m = Math.floor(pomState.remaining / 60);
  const s = String(pomState.remaining % 60).padStart(2, '0');
  const timeStr = `${String(m).padStart(2, '0')}:${s}`;
  const timeEl = document.getElementById('pomo-time');
  if (timeEl) timeEl.textContent = timeStr;
  const modeLabels = { focus: 'Focus Session', short: 'Short Break', long: 'Long Break' };
  const labelEl = document.getElementById('pomo-mode-label');
  if (labelEl) labelEl.textContent = modeLabels[pomState.mode];
  // Mini timer
  const miniTime = document.getElementById('mini-timer-display');
  if (miniTime) miniTime.textContent = timeStr;
  const miniRing = document.getElementById('mini-ring-fg');
  if (miniRing) miniRing.style.strokeDashoffset = 264 * (1 - pct);
  const miniLabel = document.getElementById('mini-session-label');
  if (miniLabel) miniLabel.textContent = pomState.mode === 'focus' ? 'Focus' : 'Break';
  // Session dots
  const dots = document.getElementById('session-dots');
  if (dots) {
    dots.innerHTML = Array.from({ length: 4 }, (_, i) =>
      `<span class="session-dot ${i < pomState.sessionCount % 4 ? 'done' : ''}"></span>`).join('');
  }
  const countLabel = document.getElementById('session-count-label');
  if (countLabel) countLabel.textContent = `Session ${(pomState.sessionCount % 4) + 1} of 4`;
  renderPomoStats();
}

function renderPomoStats() {
  const todayLogs = state.pomodoroLog.filter(l => l.date === today());
  const totalMin = todayLogs.reduce((s, l) => s + l.minutes, 0);
  const el1 = document.getElementById('pomo-total-today');
  const el2 = document.getElementById('pomo-sessions-today');
  const el3 = document.getElementById('pomo-longest');
  if (el1) el1.textContent = totalMin + ' min';
  if (el2) el2.textContent = todayLogs.length;
  if (el3) el3.textContent = state.pomodoroStats.longestStreak || pomState.sessionCount;
}

// ═══════════════════════════ HABITS ═══════════════════════════
function addHabit() {
  const input = document.getElementById('new-habit-input');
  const color = document.getElementById('new-habit-color').value;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  state.habits.push({ id: uid(), name, color, checks: {}, streak: 0 });
  input.value = '';
  saveState(); renderHabits(); updateStats();
}

function renderHabits() {
  const header = document.getElementById('habits-week-header');
  const list = document.getElementById('habits-list');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    return { key: dateKey(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }), day: d.getDate() };
  });
  if (header) {
    header.innerHTML = '<div></div>' + days.map(d => `
      <div class="week-day-label" style="${d.key === today() ? 'color:var(--accent-violet)' : ''}">
        ${d.label}<br><span style="font-size:13px;font-weight:600">${d.day}</span>
      </div>`).join('');
  }
  if (!state.habits.length) {
    if (list) list.innerHTML = '<div class="empty-state-lg">Add your first habit above to start tracking!</div>';
    renderHeatmap(); return;
  }
  if (list) {
    list.innerHTML = state.habits.map(h => {
      const streak = calcStreak(h);
      return `<div class="habit-row">
        <div class="habit-name-cell">
          <div class="habit-color-dot" style="background:${h.color}"></div>
          <div>
            <div class="habit-name">${escHtml(h.name)}</div>
            <div class="habit-streak">${streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet'}</div>
          </div>
        </div>
        ${days.map(d => `
          <div class="habit-day-cell">
            <button class="habit-check ${h.checks[d.key] ? 'checked' : ''}"
              style="${h.checks[d.key] ? `background:${h.color};border-color:${h.color}` : ''}"
              onclick="toggleHabit('${h.id}','${d.key}')"
              title="${d.label}">
              ${h.checks[d.key] ? '✓' : ''}
            </button>
          </div>`).join('')}
        <button class="habit-delete-btn" onclick="deleteHabit('${h.id}')" title="Delete">✕</button>
      </div>`;
    }).join('');
  }
  renderHeatmap();
}

function toggleHabit(id, dateKey) {
  const h = state.habits.find(h => h.id === id);
  if (!h) return;
  h.checks[dateKey] = !h.checks[dateKey];
  h.streak = calcStreak(h);
  saveState(); renderHabits(); updateStats();
}

function calcStreak(h) {
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = dateKey(d);
    if (h.checks[key]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
    if (streak > 365) break;
  }
  return streak;
}

function deleteHabit(id) {
  state.habits = state.habits.filter(h => h.id !== id);
  saveState(); renderHabits(); updateStats();
}

function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;
  const weeks = 12; const days = 7;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    const weekEl = document.createElement('div');
    weekEl.className = 'heatmap-week';
    for (let d = 0; d < days; d++) {
      const offset = -(weeks - 1 - w) * 7 - (days - 1 - d);
      const dt = new Date(); dt.setDate(dt.getDate() + offset);
      const key = dateKey(dt);
      const count = state.habits.filter(h => h.checks[key]).length;
      const level = count === 0 ? 0 : count === 1 ? 1 : count <= 2 ? 2 : count <= 3 ? 3 : 4;
      const cell = document.createElement('div');
      cell.className = `heatmap-cell ${level > 0 ? 'h' + level : ''}`;
      cell.title = `${key}: ${count} habit${count !== 1 ? 's' : ''} done`;
      weekEl.appendChild(cell);
    }
    grid.appendChild(weekEl);
  }
}

// ═══════════════════════════ NOTES ═══════════════════════════
function newNote() {
  const note = { id: uid(), title: 'Untitled Note', content: '', tags: [], pinned: false, created: Date.now() };
  state.notes.unshift(note);
  state.currentNoteId = note.id;
  saveState(); renderNotes(); renderNoteEditor();
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  if (!list) return;
  const filter = list.dataset.filter || 'all';
  let notes = [...state.notes].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.created || 0) - (a.created || 0);
  });
  if (filter === 'pinned') notes = notes.filter(n => n.pinned);
  if (filter === 'tagged') notes = notes.filter(n => n.tags.length > 0);
  if (!notes.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px">No notes found.</div>';
  } else {
    list.innerHTML = notes.map(n => `
      <div class="note-list-item ${n.id === state.currentNoteId ? 'active' : ''}" onclick="openNote('${n.id}')">
        <div class="note-list-title">${n.pinned ? '📌 ' : ''}${escHtml(n.title)}</div>
        <div class="note-list-preview">${escHtml(n.content.slice(0, 60)) || 'Empty note'}</div>
        ${n.tags.length ? `<div class="note-list-tags">${n.tags.map(t => `<span class="note-tag">#${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`).join('');
  }
  updateStats();
  if (state.currentNoteId) renderNoteEditor();
}

function openNote(id) {
  state.currentNoteId = id;
  renderNotes(); renderNoteEditor();
}

function renderNoteEditor() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  const titleEl = document.getElementById('note-title-input');
  const contentEl = document.getElementById('note-content');
  const pinBtn = document.getElementById('pin-btn');
  const tagsRow = document.getElementById('note-tags-row');
  if (!note || !titleEl) return;
  titleEl.value = note.title;
  contentEl.value = note.content;
  if (pinBtn) pinBtn.style.opacity = note.pinned ? '1' : '0.4';
  if (tagsRow) {
    tagsRow.innerHTML = note.tags.map(t => `
      <span class="note-tag" style="cursor:pointer" onclick="removeTag('${escHtml(t)}')">#${escHtml(t)} ✕</span>`).join('');
  }
  updateWordCount();
}

function saveCurrentNote() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (!note) return;
  delete note.sample; // edited by the user, so it is no longer a sample
  note.title = document.getElementById('note-title-input').value || 'Untitled';
  note.content = document.getElementById('note-content').value;
  note.updated = Date.now();
  saveState(); renderNotes();
  flashSaved();
}

function flashSaved() {
  const btn = document.querySelector('#note-editor .btn-primary');
  if (btn) { btn.textContent = '✓ Saved!'; setTimeout(() => btn.textContent = 'Save Note', 1500); }
}

function togglePinNote() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (!note) return;
  note.pinned = !note.pinned;
  saveState(); renderNotes(); renderNoteEditor();
}

function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  state.notes = state.notes.filter(n => n.id !== state.currentNoteId);
  state.currentNoteId = state.notes[0]?.id || null;
  saveState(); renderNotes();
  if (!state.currentNoteId) {
    const titleEl = document.getElementById('note-title-input');
    const contentEl = document.getElementById('note-content');
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
  }
}

function addTagToNote() {
  const tag = prompt('Add tag:')?.trim().toLowerCase();
  if (!tag) return;
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (note && !note.tags.includes(tag)) { note.tags.push(tag); saveState(); renderNotes(); renderNoteEditor(); }
}

function removeTag(tag) {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (note) { note.tags = note.tags.filter(t => t !== tag); saveState(); renderNoteEditor(); }
}

function updateWordCount() {
  const content = document.getElementById('note-content')?.value || '';
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const el = document.getElementById('note-word-count');
  if (el) el.textContent = words + ' word' + (words !== 1 ? 's' : '');
}

document.addEventListener('input', e => {
  if (e.target.id === 'note-content') updateWordCount();
});

function searchNotes() {
  const query = document.getElementById('notes-search').value.toLowerCase();
  const list = document.getElementById('notes-list');
  if (!list) return;
  const notes = state.notes.filter(n =>
    n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query)
  ).sort((a, b) => (b.created || 0) - (a.created || 0));
  list.innerHTML = notes.map(n => `
    <div class="note-list-item ${n.id === state.currentNoteId ? 'active' : ''}" onclick="openNote('${n.id}')">
      <div class="note-list-title">${n.pinned ? '📌 ' : ''}${escHtml(n.title)}</div>
      <div class="note-list-preview">${escHtml(n.content.slice(0, 60)) || 'Empty note'}</div>
    </div>`).join('') || '<div class="empty-state" style="padding:24px">No results.</div>';
}

function filterNotes(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const list = document.getElementById('notes-list');
  if (list) list.dataset.filter = filter;
  renderNotes();
}

async function summarizeNote() {
  const note = state.notes.find(n => n.id === state.currentNoteId);
  if (!note || !note.content.trim()) { alert('Note is empty.'); return; }
  const contentEl = document.getElementById('note-content');
  const original = note.content;
  contentEl.value = 'AI is summarizing…';
  try {
    const summary = await callAI(`Summarize this note concisely in 2-3 sentences:\n\n${note.content}`);
    note.content = `## AI Summary\n${summary}\n\n---\n\n${original}`;
    contentEl.value = note.content;
    saveState(); updateWordCount();
  } catch (e) { contentEl.value = original; alert('Could not summarize.'); }
}

// ═══════════════════════════ ANALYTICS ═══════════════════════════
let focusChartInstance = null, donutChartInstance = null, velocityChartInstance = null;

function renderAnalytics() {
  const days = parseInt(document.getElementById('analytics-range')?.value || 7);
  renderFocusChart(days);
  renderTaskDonut();
  renderHabitBars();
  renderProductivityScore();
  renderVelocityChart(days);
}

function renderFocusChart(days) {
  const canvas = document.getElementById('focusChart');
  if (!canvas) return;
  const labels = [], data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = dateKey(d);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const mins = state.pomodoroLog.filter(l => l.date === key).reduce((s, l) => s + l.minutes, 0);
    data.push(mins);
  }
  if (focusChartInstance) focusChartInstance.destroy();
  focusChartInstance = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Focus (min)', data, backgroundColor: 'rgba(167,139,250,0.5)', borderColor: '#a78bfa', borderWidth: 1, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
  });
}

function renderTaskDonut() {
  const canvas = document.getElementById('taskDonut');
  if (!canvas) return;
  const cols = ['todo', 'inprogress', 'review', 'done'];
  const colors = ['rgba(120,120,140,0.7)', 'rgba(167,139,250,0.8)', 'rgba(245,158,11,0.8)', 'rgba(16,185,129,0.8)'];
  const labels = ['To Do', 'In Progress', 'Review', 'Done'];
  const data = cols.map(c => state.tasks.filter(t => t.col === c).length);
  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
  });
  const legend = document.getElementById('donut-legend');
  if (legend) {
    legend.innerHTML = labels.map((l, i) => `
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)">
        <div style="width:8px;height:8px;border-radius:50%;background:${colors[i]}"></div>${l}: ${data[i]}
      </div>`).join('');
  }
}

function renderHabitBars() {
  const container = document.getElementById('habit-bars');
  if (!container) return;
  if (!state.habits.length) { container.innerHTML = '<div class="empty-state">No habits yet.</div>'; return; }
  const totalDays = 30;
  container.innerHTML = state.habits.map(h => {
    let done = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (h.checks[dateKey(d)]) done++;
    }
    const pct = Math.round((done / totalDays) * 100);
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px">
        <span>${escHtml(h.name)}</span><span style="font-family:var(--font-mono);color:${h.color}">${pct}%</span>
      </div>
      <div style="height:6px;background:var(--glass-border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${h.color};border-radius:3px;transition:width 1s ease"></div>
      </div>
    </div>`;
  }).join('');
}

function renderProductivityScore() {
  const totalTasks = state.tasks.length;
  const doneTasks = state.tasks.filter(t => t.col === 'done').length;
  const todayLogs = state.pomodoroLog.filter(l => l.date === today());
  const focusMins = todayLogs.reduce((s, l) => s + l.minutes, 0);
  const doneHabits = state.habits.filter(h => h.checks[today()]).length;
  const totalHabits = state.habits.length;
  let score = 0;
  if (totalTasks > 0) score += (doneTasks / totalTasks) * 40;
  score += Math.min(focusMins / 120 * 30, 30);
  if (totalHabits > 0) score += (doneHabits / totalHabits) * 30;
  score = Math.round(score);
  const circum = 364;
  const ring = document.getElementById('score-fg-ring');
  if (ring) ring.style.strokeDashoffset = circum * (1 - score / 100);
  const val = document.getElementById('score-value');
  if (val) val.textContent = score;
  const desc = document.getElementById('score-desc');
  if (desc) {
    desc.textContent = score >= 80 ? '🔥 Outstanding productivity!' : score >= 60 ? '⚡ Great momentum!' : score >= 40 ? '📈 Keep building.' : score > 0 ? '🌱 Just getting started.' : 'Complete tasks and habits to build your score.';
  }
}

function renderVelocityChart(days) {
  const canvas = document.getElementById('velocityChart');
  if (!canvas) return;
  const labels = [], data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const key = dateKey(d);
    data.push(state.tasks.filter(t => t.doneAt && dateKey(new Date(t.doneAt)) === key).length);
  }
  if (velocityChartInstance) velocityChartInstance.destroy();
  velocityChartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Tasks Completed', data, borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.1)', borderWidth: 2, pointRadius: 3, tension: 0.4, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
  });
}

// =========================== NEXAI ASSISTANT ===========================
// Chats are saved on the server (MongoDB), so they survive refreshes and new devices.
let chatList = [];        // [{ id, title, updatedAt }] newest first
let activeChatId = null;  // null = a new chat that is not saved yet
let chatBusy = false;     // true while waiting for a reply
let welcomeHtml = '';     // the welcome bubble, copied from the page on first load

function buildSystemContext() {
  const tasksActive = state.tasks.filter(t => t.col !== 'done');
  const tasksDone = state.tasks.filter(t => t.col === 'done');
  const focusMins = state.pomodoroLog.filter(l => l.date === today()).reduce((s, l) => s + l.minutes, 0);
  const doneHabits = state.habits.filter(h => h.checks[today()]);
  const recentNotes = state.notes.slice(0, 3);
  return `You are NexAI, the intelligent, empathetic assistant inside NexOS, built on Google Gemini. You have full context of the user's data.

Current Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

TASKS:
- Active tasks (${tasksActive.length}): ${tasksActive.map(t => `"${t.title}" [${t.priority}/${t.col}]`).join(', ') || 'None'}
- Completed today (${tasksDone.length}): ${tasksDone.map(t => t.title).slice(0, 5).join(', ') || 'None'}

FOCUS:
- Today's focus time: ${focusMins} minutes
- Total pomodoro sessions today: ${state.pomodoroLog.filter(l => l.date === today()).length}

HABITS (today):
- Done: ${doneHabits.map(h => h.name).join(', ') || 'None yet'}
- Pending: ${state.habits.filter(h => !h.checks[today()]).map(h => h.name).join(', ') || 'All done!'}
- Active habit streaks: ${state.habits.map(h => `${h.name}: ${h.streak || 0}d`).join(', ') || 'None'}

NOTES (recent titles):
${recentNotes.map(n => `- "${n.title}"`).join('\n') || 'None'}

Be concise, warm, and actionable. Use emojis sparingly. Format responses clearly.

You can only give advice. You cannot change the user's tasks, habits or notes, so tell them what to do in the app instead of saying you did it.`;
}

async function initChat() {
  const box = document.getElementById('chat-messages');
  if (box && !welcomeHtml) welcomeHtml = box.innerHTML;
  await loadChatList();
  if (chatList.length) await openChat(chatList[0].id);
}

async function loadChatList() {
  try {
    const res = await fetch('/api/chats');
    if (!res.ok) throw new Error('status ' + res.status);
    chatList = (await res.json()).chats || [];
  } catch (e) { console.warn('Could not load chats', e); }
  renderChatList();
  renderGuide();
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + ' d ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderChatList() {
  const el = document.getElementById('chat-list');
  if (!el) return;
  if (!chatList.length) { el.innerHTML = '<div class="chat-list-empty">Your chats will appear here.</div>'; return; }
  el.innerHTML = chatList.map(c => `
    <div class="chat-list-item ${c.id === activeChatId ? 'active' : ''}" onclick="openChat('${escHtml(c.id)}')">
      <div class="chat-list-main">
        <div class="chat-list-title">${escHtml(c.title)}</div>
        <div class="chat-list-date">${timeAgo(c.updatedAt)}</div>
      </div>
      <button class="chat-list-del" title="Delete chat" onclick="event.stopPropagation(); deleteChat('${escHtml(c.id)}')">\u2715</button>
    </div>`).join('');
}

function upsertChat(chat) {
  chatList = [chat, ...chatList.filter(c => c.id !== chat.id)];
  renderChatList();
}

function setChips(visible) {
  const chips = document.getElementById('suggested-prompts');
  if (chips) chips.style.display = visible ? '' : 'none';
}

function renderMessages(messages) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  box.innerHTML = '';
  if (!messages.length) box.innerHTML = welcomeHtml;
  else messages.forEach(m => appendChatMsg(m.role, m.content));
  setChips(!messages.length);
  scrollChat();
}

async function openChat(id) {
  if (chatBusy) return;
  try {
    const res = await fetch('/api/chats/' + encodeURIComponent(id));
    if (!res.ok) throw new Error('status ' + res.status);
    const { chat } = await res.json();
    activeChatId = chat.id;
    renderMessages(chat.messages || []);
  } catch (e) {
    appendChatMsg('assistant', 'Could not open that chat. Please try again.', 'error');
  }
  renderChatList();
}

function newChat() {
  if (chatBusy) return;
  activeChatId = null;
  renderMessages([]);
  renderChatList();
  document.getElementById('chat-input')?.focus();
}

async function deleteChat(id) {
  if (chatBusy) return;
  if (!confirm('Delete this chat? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) throw new Error('status ' + res.status);
    chatList = chatList.filter(c => c.id !== id);
    if (activeChatId === id) { activeChatId = null; renderMessages([]); }
    renderChatList();
  } catch (e) {
    appendChatMsg('assistant', 'Could not delete the chat. Please try again.', 'error');
  }
}

async function sendMessage() {
  if (chatBusy) return;
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  chatBusy = true;
  document.querySelectorAll('#chat-messages .chat-msg.error').forEach(n => n.remove());
  input.value = '';
  autoResizeTextarea(input);
  setChips(false);
  const userDiv = appendChatMsg('user', msg);
  showTyping();
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const data = await callAIChat(activeChatId, msg, buildSystemContext());
    removeTyping();
    appendChatMsg('assistant', data.text);
    activeChatId = data.chatId;
    upsertChat({ id: data.chatId, title: data.title, updatedAt: data.updatedAt });
    if (!state.usedAI) { state.usedAI = true; saveState(); }
  } catch (e) {
    // Nothing was saved on the server, so undo the message and put the text back to retry.
    removeTyping();
    userDiv?.remove();
    input.value = msg;
    autoResizeTextarea(input);
    appendChatMsg('assistant', e.userMessage || 'Could not reach NexAI. Please try again.', 'error');
    if (!activeChatId) setChips(true);
  }
  chatBusy = false;
  if (sendBtn) sendBtn.disabled = false;
  scrollChat();
}

function sendSuggestedPrompt(text) {
  if (chatBusy) return;
  switchView('ai');
  document.getElementById('chat-input').value = text;
  sendMessage();
}

// Escapes the text first (so AI output can never inject HTML), then applies simple formatting.
function formatChat(text) {
  return escHtml(text)
    .replace(/^#{1,6}[ \t]+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^[ \t]*[*-][ \t]+/gm, '\u2022 ')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:var(--bg-card);padding:2px 5px;border-radius:3px;font-family:var(--font-mono);font-size:12px">$1</code>')
    .replace(/\n/g, '<br>');
}

function appendChatMsg(role, content, extraClass = '') {
  const messages = document.getElementById('chat-messages');
  if (!messages) return null;
  const div = document.createElement('div');
  div.className = `chat-msg ${role} ${extraClass}`.trim();
  div.innerHTML = `
    <div class="msg-avatar">${role === 'assistant' ? '\u2726' : 'U'}</div>
    <div class="msg-bubble"><p>${formatChat(content)}</p></div>`;
  messages.appendChild(div);
  scrollChat();
  return div;
}

function showTyping() {
  const messages = document.getElementById('chat-messages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = 'chat-msg assistant'; div.id = 'typing-indicator';
  div.innerHTML = `<div class="msg-avatar">\u2726</div><div class="msg-bubble"><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`;
  messages.appendChild(div);
  scrollChat();
}
function removeTyping() { document.getElementById('typing-indicator')?.remove(); }
function scrollChat() { const m = document.getElementById('chat-messages'); if (m) m.scrollTop = m.scrollHeight; }

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  autoResizeTextarea(e.target);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function updateContextPanel() {
  const active = state.tasks.filter(t => t.col !== 'done').length;
  const done = state.tasks.filter(t => t.col === 'done').length;
  const focusMins = state.pomodoroLog.filter(l => l.date === today()).reduce((s, l) => s + l.minutes, 0);
  const doneHabits = state.habits.filter(h => h.checks[today()]).length;
  const setCtx = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setCtx('ctx-tasks', `${active} active, ${done} done`);
  setCtx('ctx-focus', `${focusMins} min today`);
  setCtx('ctx-habits', `${doneHabits}/${state.habits.length} done`);
  setCtx('ctx-notes', `${state.notes.length} notes`);
}

async function getDailyInsight() {
  const btn = document.querySelector('#ai-insight-bar .btn-sm');
  const text = document.getElementById('ai-insight-text');
  if (btn) btn.textContent = '…';
  if (text) text.textContent = 'Generating insight…';
  try {
    const insight = await callAI(
      `Based on this productivity snapshot, give ONE sharp, actionable insight in 1-2 sentences:\n${buildSystemContext()}`,
      'You are a concise productivity assistant. One key insight only.'
    );
    if (text) text.textContent = insight;
    if (btn) btn.textContent = 'Refresh';
  } catch (e) {
    if (text) text.textContent = e.userMessage || 'Could not load insight. Try again.';
    if (btn) btn.textContent = 'Retry';
  }
}

// =========================== AI API (Google Gemini) ===========================
// All AI calls go through the secure backend proxy, so the API key never reaches the browser.
async function apiErrorMessage(response) {
  try { const d = await response.json(); if (d && d.error) return d.error; } catch (_) {}
  if (response.status === 401) return 'Your session expired. Please sign in again.';
  if (response.status === 429) return 'Too many requests. Please wait a few seconds and try again.';
  return 'Something went wrong. Please try again.';
}

async function postJSON(url, body) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (_) {
    const err = new Error('network');
    err.userMessage = 'Could not reach the server. Check your internet connection and try again.';
    throw err;
  }
  if (!response.ok) {
    const err = new Error('API error ' + response.status);
    err.userMessage = await apiErrorMessage(response);
    throw err;
  }
  return response.json();
}

// One-off prompt (insight, task description, note summary). Not saved.
async function callAI(prompt, systemPrompt = 'You are a helpful productivity assistant.') {
  const data = await postJSON('/api/complete', { prompt, system: systemPrompt });
  return data.text || '';
}

// A chat message. The server saves it and the reply to the chat's history.
function callAIChat(chatId, message, system) {
  return postJSON('/api/chat', { chatId, message, system });
}

// ═══════════════════════════ HELPERS ═══════════════════════════
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    const shortcuts = { '1': 'dashboard', '2': 'kanban', '3': 'pomodoro', '4': 'habits', '5': 'notes', '6': 'analytics', '7': 'ai' };
    if (shortcuts[e.key]) { e.preventDefault(); switchView(shortcuts[e.key]); }
    if (e.key === 's' && document.getElementById('view-notes').classList.contains('active')) {
      e.preventDefault(); saveCurrentNote();
    }
  }
  if (e.key === 'Escape') closeTaskModal();
});

// Mini gradient def for ring
document.addEventListener('DOMContentLoaded', () => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS, 'defs');
  const grad = document.createElementNS(svgNS, 'linearGradient');
  grad.setAttribute('id', 'miniGrad');
  grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
  const s1 = document.createElementNS(svgNS, 'stop');
  s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#a78bfa');
  const s2 = document.createElementNS(svgNS, 'stop');
  s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#06b6d4');
  grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad);
  const miniSvg = document.querySelector('.mini-ring-svg');
  if (miniSvg) miniSvg.insertBefore(defs, miniSvg.firstChild);
  renderPomTimer();
  renderPomoStats();
});
