/* ═══════════════════════════════════════════════════════
   NexOS UI layer
   Appearance (Google / Microsoft design, light / dark), toasts with Undo,
   the New menu, the task list view, sync status and dialog focus handling.
═══════════════════════════════════════════════════════ */
(function () {
  const root = document.documentElement;
  const PREF_KEY = 'nexos_ui_v1';
  const VIEW_KEY = 'nexos_taskview_v1';
  const BAR_COLORS = { 'google-light': '#F8FAFD', 'google-dark': '#131314', 'microsoft-light': '#0F6CBD', 'microsoft-dark': '#0C3B5E' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // ───────── appearance (stored per device) ─────────
  function readPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (_) {}
    return {
      design: p.design === 'microsoft' ? 'microsoft' : 'google',
      theme: ['light', 'dark', 'system'].includes(p.theme) ? p.theme : 'system',
      saved: !!(p.design || p.theme),
    };
  }
  function savePrefs(partial) {
    const next = { ...readPrefs(), ...partial };
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ design: next.design, theme: next.theme })); } catch (_) {}
  }
  function resolveTheme(theme) { return theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : theme; }

  function apply() {
    const prefs = readPrefs();
    const resolved = resolveTheme(prefs.theme);
    root.dataset.design = prefs.design;
    root.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BAR_COLORS[prefs.design + '-' + resolved]);
    syncAppearanceControls();
    return resolved;
  }
  function syncAppearanceControls() {
    const prefs = readPrefs();
    document.querySelectorAll('[data-design-pick]').forEach(b => {
      const on = b.dataset.designPick === prefs.design;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-theme-pick]').forEach(b => {
      const on = b.dataset.themePick === prefs.theme;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
  }
  function refresh() {
    if (typeof applyTheme === 'function' && typeof state !== 'undefined') applyTheme(); else apply();
    const login = document.getElementById('login-screen');
    if (login && login.style.display !== 'none' && typeof showLogin === 'function') showLogin(); // restyle the Google button
  }
  function setDesign(design) {
    savePrefs({ design: design === 'microsoft' ? 'microsoft' : 'google' });
    refresh();
    toast(design === 'microsoft' ? 'Microsoft design applied' : 'Google design applied');
  }
  function setTheme(theme) { savePrefs({ theme }); refresh(); }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (readPrefs().theme === 'system') refresh(); });

  // ───────── toasts / snackbars ─────────
  function toast(message, opts = {}) {
    const host = document.getElementById('toasts');
    if (!host) return null;
    const text = String(message || '');
    const type = opts.type || (/could not|couldn.t|failed|error|blocked|not supported|expired|unable|choose a valid|sign in to/i.test(text) ? 'error' : 'info');
    while (host.children.length >= 3) host.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const span = document.createElement('span');
    span.className = 'toast-text';
    span.textContent = text;
    el.appendChild(span);
    let timer = null;
    const dismiss = () => { clearTimeout(timer); el.classList.add('leaving'); setTimeout(() => el.remove(), 160); };
    if (opts.action) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'toast-action'; btn.textContent = opts.action;
      btn.addEventListener('click', () => { try { opts.onAction && opts.onAction(); } finally { dismiss(); } });
      el.appendChild(btn);
    }
    if (opts.sticky) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'toast-x'; x.setAttribute('aria-label', 'Dismiss');
      x.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-close"/></svg>';
      x.addEventListener('click', dismiss);
      el.appendChild(x);
    }
    host.appendChild(el);
    const start = () => { if (!opts.sticky) timer = setTimeout(dismiss, opts.action ? 7000 : 4500); };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
    start();
    return el;
  }

  // ───────── sync status ─────────
  const SYNC_TEXT = { saved: 'Saved', saving: 'Saving…', offline: 'Offline · saved on this device', local: 'Saved on this device', expired: 'Sign in to sync' };
  function setSync(stateName) {
    const chip = document.getElementById('sync-chip');
    const text = document.getElementById('sync-text');
    if (!chip || !text) return;
    chip.dataset.state = stateName;
    text.textContent = SYNC_TEXT[stateName] || 'Saved';
  }

  // ───────── New menu ─────────
  function closeMenus() {
    const menu = document.getElementById('new-menu');
    if (menu && !menu.hidden) menu.hidden = true;
    document.getElementById('new-btn')?.setAttribute('aria-expanded', 'false');
  }
  function toggleNewMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('new-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    document.getElementById('new-btn')?.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) menu.querySelector('button')?.focus();
  }
  function newItem(kind) {
    closeMenus();
    if (kind === 'task') { switchView('kanban'); setTimeout(() => document.getElementById('new-task-input')?.focus(), 60); }
    else if (kind === 'note') { switchView('notes'); newNote(); }
    else if (kind === 'habit') { switchView('habits'); setTimeout(() => document.getElementById('new-habit-input')?.focus(), 60); }
    else if (kind === 'plan') openPlanModal();
    else if (kind === 'action') openNexAIActionMode();
  }
  document.addEventListener('click', e => { if (!e.target.closest('#new-menu, #new-btn, #fab')) closeMenus(); });

  // ───────── dialogs ─────────
  function openSettings() {
    if (typeof openProfile === 'function') openProfile();
    setTimeout(() => document.getElementById('profile-appearance')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }
  function openShortcuts() { document.getElementById('shortcuts-modal')?.classList.add('is-open'); }
  function closeShortcuts(event) {
    if (!event || event.target.id === 'shortcuts-modal' || event.target.closest('.modal-close')) document.getElementById('shortcuts-modal')?.classList.remove('is-open');
  }
  function closeAll() { closeShortcuts(); closeMenus(); const p = document.getElementById('prompt-modal'); if (p && p.style.display !== 'none') p.querySelector('#prompt-cancel')?.click(); }

  // A small replacement for window.prompt().
  function promptText(title, placeholder) {
    return new Promise(resolve => {
      const modal = document.getElementById('prompt-modal');
      const input = document.getElementById('prompt-input');
      if (!modal || !input) { resolve(window.prompt(title)); return; }
      document.getElementById('prompt-title').textContent = title;
      input.placeholder = placeholder || '';
      input.value = '';
      modal.style.display = 'flex';
      const ok = document.getElementById('prompt-ok'), cancel = document.getElementById('prompt-cancel'), form = document.getElementById('prompt-form');
      const finish = value => { modal.style.display = 'none'; ok.onclick = cancel.onclick = form.onsubmit = modal.onclick = null; resolve(value); };
      ok.onclick = () => finish(input.value);
      cancel.onclick = () => finish(null);
      form.onsubmit = e => { e.preventDefault(); finish(input.value); };
      modal.onclick = e => { if (e.target === modal) finish(null); };
      setTimeout(() => input.focus(), 30);
    });
  }

  // Focus: move into an opened dialog, keep Tab inside it, and return focus to where it was.
  const opened = new Map();
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const focusables = el => [...el.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && visible(n));
  function syncOverlay(el) {
    const isOpen = getComputedStyle(el).display !== 'none';
    if (isOpen && !opened.has(el)) {
      opened.set(el, document.activeElement);
      setTimeout(() => {
        if (el.contains(document.activeElement)) return;
        // Focus the dialog itself, never a text field: focusing a field raises the on-screen keyboard on phones
        // and resizes the page. Dialogs that want typing (search, tag prompt) focus their own field.
        const box = el.querySelector('.modal') || el;
        if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
        box.focus({ preventScroll: true });
      }, 40);
    } else if (!isOpen && opened.has(el)) {
      const prev = opened.get(el); opened.delete(el);
      if (prev && prev.isConnected && prev.focus && visible(prev)) prev.focus();
    }
  }
  new MutationObserver(list => {
    for (const m of list) { const t = m.target; if (t.classList && t.classList.contains('modal-overlay')) syncOverlay(t); }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const overlay = [...opened.keys()].pop();
    if (!overlay) return;
    const list = focusables(overlay);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ───────── task list view ─────────
  function getTaskView() { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch (_) { return 'board'; } }
  function setTaskView(view) {
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    syncTaskView();
  }
  function syncTaskView() {
    const view = getTaskView();
    const board = document.getElementById('kanban-board');
    const list = document.getElementById('task-list-view');
    if (board) board.hidden = view === 'list';
    if (list) list.hidden = view !== 'list';
    [['tv-board', 'board'], ['tv-list', 'list']].forEach(([id, v]) => {
      const b = document.getElementById(id);
      if (b) { b.classList.toggle('active', v === view); b.setAttribute('aria-pressed', String(v === view)); }
    });
    renderTaskList();
  }
  function renderTaskList() {
    const el = document.getElementById('task-list-view');
    if (!el || el.hidden || typeof state === 'undefined') return;
    const t0 = today();
    const open = openTasksSorted();
    const done = state.tasks.filter(t => t.col === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 25);
    const groups = [
      ['Overdue', open.filter(t => t.due && t.due < t0), 'overdue'],
      ['Today', open.filter(t => t.due === t0), ''],
      ['Upcoming', open.filter(t => t.due && t.due > t0), ''],
      ['No due date', open.filter(t => !t.due), ''],
      ['Completed', done, 'completed'],
    ].filter(g => g[1].length);
    const row = t => {
      const isDone = t.col === 'done';
      return `<div class="tl-row priority-${t.priority} ${isDone ? 'done' : ''}">
        <button type="button" class="task-check ${isDone ? 'checked' : ''}" onclick="toggleTaskDone('${t.id}')" aria-pressed="${isDone}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}: ${escHtml(t.title)}"></button>
        <button type="button" class="tl-main" onclick="openTaskModal('${t.id}')">
          <span class="tl-text">${escHtml(t.title)}</span>
          <span class="tl-meta"><span class="meta-chip">${STAGE_LABELS[t.col] || t.col}</span><span class="meta-chip pri-${t.priority}">${t.priority}</span>${dueChip(t)}</span>
        </button>
        <button type="button" class="tl-del" onclick="deleteTask('${t.id}')" aria-label="Delete ${escHtml(t.title)}"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </div>`;
    };
    el.innerHTML = groups.length
      ? groups.map(([title, items, cls]) => `<section class="tl-group ${cls}"><h3 class="tl-heading">${title}<span>${items.length}</span></h3>${items.map(row).join('')}</section>`).join('')
      : '<div class="empty-state-lg">No tasks yet. Add your first task above.</div>';
  }

  // ───────── init ─────────
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    syncTaskView();
    const hint = document.getElementById('kbd-hint');
    if (hint && /Mac|iPhone|iPad/.test(navigator.platform || '')) hint.textContent = '⌘ K';
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });

  window.NexUI = {
    apply, hasPrefs: () => readPrefs().saved, savePrefs, setDesign, setTheme, syncAppearanceControls,
    toast, setSync, closeMenus, toggleNewMenu, newItem, openSettings, openShortcuts, closeShortcuts, closeAll,
    promptText, setTaskView, renderTaskList,
  };
})();

// Used by the task list and keyboard flows.
function toggleTaskDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (task.col !== 'done') { completeTask(id); return; }
  setTaskCol(task, 'todo');
  saveState(); renderKanban(); renderDashboard(); updateStats(); updateContextPanel(); renderAnalytics();
}
// Mobile: go from the open note back to the list.
function closeNoteEditor() { document.getElementById('note-editor')?.classList.remove('is-open'); }
