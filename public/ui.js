/* ═══════════════════════════════════════════════════════
   NexOS UI layer
   Appearance (Google / Apple design, light / dark), toasts with Undo,
   the New menu, the task list view, sync status and dialog focus handling.
═══════════════════════════════════════════════════════ */
(function () {
  const root = document.documentElement;
  const PREF_KEY = 'nexos_ui_v1';
  const VIEW_KEY = 'nexos_taskview_v1';
  const BAR_COLORS = { 'google-light': '#F8FAFD', 'google-dark': '#131314', 'apple-light': '#F2F2F7', 'apple-dark': '#000000' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // ───────── appearance (stored per device) ─────────
  function readPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (_) {}
    return {
      design: (p.design === 'apple' || p.design === 'microsoft') ? 'apple' : 'google', // 'microsoft' was the old name of this slot
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
    savePrefs({ design: design === 'apple' ? 'apple' : 'google' });
    refresh();
    toast(design === 'apple' ? 'Apple design applied' : 'Google design applied');
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
    const look = document.getElementById('appearance-menu');
    if (look && !look.hidden) look.hidden = true;
    document.getElementById('appearance-btn')?.setAttribute('aria-expanded', 'false');
  }
  function toggleAppearanceMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('appearance-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    document.getElementById('appearance-btn')?.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) { syncAppearanceControls(); menu.querySelector('.seg-btn.active, .seg-btn')?.focus({ preventScroll: true }); }
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
  document.addEventListener('click', e => { if (!e.target.closest('#new-menu, #new-btn, #fab, #appearance-menu, #appearance-btn')) closeMenus(); });

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
  // Only modal roots can affect dialog focus. Watching every class/style mutation in
  // the entire application created avoidable observer work during navigation and renders.
  const overlayObserver = new MutationObserver(records => {
    for (const record of records) syncOverlay(record.target);
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
  });
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
    toast, setSync, closeMenus, toggleNewMenu, toggleAppearanceMenu, newItem, openSettings, openShortcuts, closeShortcuts, closeAll,
    promptText, setTaskView, renderTaskList,
  };
})();

/* NexOS 3.2.0 voice input: a mic beside the NexAI chat, Action Mode and Add Task fields (Web Speech API). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // Unsupported browsers keep the normal typing UI with no dead buttons.
  const LANG_KEY = 'nexos_voice_lang';
  const TARGETS = [
    { id: 'chat-input', mode: 'before', ref: 'chat-send-btn' },
    { id: 'new-task-input', mode: 'after' },
    { id: 'modal-title-input', mode: 'label' },
    { id: 'modal-desc-input', mode: 'label' },
    { id: 'nexos-action-request', mode: 'label' },
  ];
  let active = null;   // { rec, btn }
  let longFired = false;

  const lang = () => { try { return localStorage.getItem(LANG_KEY) === 'hi-IN' ? 'hi-IN' : 'en-IN'; } catch (_) { return 'en-IN'; } };
  const say = (msg) => { if (window.NexUI && NexUI.toast) NexUI.toast(msg); };

  function injectStyle() {
    if (document.getElementById('nexos-mic-styles')) return;
    const st = document.createElement('style');
    st.id = 'nexos-mic-styles';
    st.textContent = '.nexos-mic{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--border,rgba(128,128,128,.35));background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}'
      + '.nexos-mic.is-label{float:right;width:28px;height:28px;font-size:14px;margin:-4px 0 4px 8px}'
      + '.nexos-mic.is-recording{background:rgba(220,38,38,.18);border-color:#dc2626;animation:nexosMicPulse 1.2s infinite}'
      + '@keyframes nexosMicPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}';
    document.head.appendChild(st);
  }

  function stop() {
    if (!active) return;
    const { rec, btn } = active;
    active = null;
    btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false');
    try { rec.stop(); } catch (_) {}
  }

  // Builds the full spoken text from every result of a recognition event. Some browsers (Android Chrome) send growing
  // partial results even when interimResults is off, so a result is never appended: the field is rewritten as
  // "text that was there before the mic" + "everything heard so far".
  function spokenText(results) {
    let spoken = '';
    for (let i = 0; results && i < results.length; i++) {
      const alt = results[i] && results[i][0];
      const piece = alt && alt.transcript ? String(alt.transcript).trim() : '';
      if (!piece) continue;
      const a = spoken.toLowerCase(), b = piece.toLowerCase();
      if (!spoken || b.startsWith(a)) spoken = piece;
      else if (!a.endsWith(b)) spoken += ' ' + piece;
    }
    return spoken;
  }

  function start(field, btn) {
    const rec = new SR();
    rec.lang = lang(); rec.continuous = false; rec.interimResults = false;
    active = { rec, btn };
    btn.classList.add('is-recording'); btn.setAttribute('aria-pressed', 'true');
    say('Listening… speak now');
    field.blur(); // Keep the mobile keyboard closed while the microphone is listening.\n    const baseText = field.value ? field.value.replace(/\s+$/, '') + ' ' : ''; // what was in the field before the mic
    rec.onresult = (e) => {
      const text = spokenText(e.results);
      if (!text) return;
      let next = baseText + text;
      if (field.maxLength > 0) next = next.slice(0, field.maxLength);
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      // Do not focus the field here: mobile browsers may open the keyboard after dictation ends.
    };
    rec.onerror = (e) => {
      const code = e && e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') say('Microphone is blocked. Allow it in your browser settings.');
      else if (code === 'no-speech') say('Did not hear anything. Try again.');
      else if (code !== 'aborted') say('Voice input failed. Please try again.');
    };
    rec.onend = () => { if (active && active.rec === rec) { btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false'); active = null; } };
    try { rec.start(); } catch (_) { stop(); }
  }

  function makeButton(id, asLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nexos-mic' + (asLabel ? ' is-label' : '');
    btn.dataset.micFor = id;
    btn.setAttribute('aria-label', 'Voice input'); btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Tap to speak. Long-press to switch English / Hindi.';
    btn.textContent = '🎙️';
    let timer = null;
    const cancel = () => { clearTimeout(timer); timer = null; };
    btn.addEventListener('pointerdown', () => {
      longFired = false;
      timer = setTimeout(() => {
        longFired = true; timer = null;
        const nextLang = lang() === 'hi-IN' ? 'en-IN' : 'hi-IN';
        try { localStorage.setItem(LANG_KEY, nextLang); } catch (_) {}
        say(nextLang === 'hi-IN' ? 'Voice language: Hindi' : 'Voice language: English (India)');
      }, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, cancel));
    btn.addEventListener('contextmenu', (e) => { if (longFired) e.preventDefault(); });
    btn.addEventListener('click', () => {
      if (longFired) { longFired = false; return; }
      const field = document.getElementById(id);
      if (!field) return;
      const wasThis = active && active.btn === btn;
      stop();
      if (!wasThis) start(field, btn);
    });
    return btn;
  }

  function scan() {
    TARGETS.forEach((t) => {
      const field = document.getElementById(t.id);
      if (!field || document.querySelector('.nexos-mic[data-mic-for="' + t.id + '"]')) return;
      if (t.mode === 'before') {
        const ref = document.getElementById(t.ref);
        if (ref && ref.parentNode) ref.parentNode.insertBefore(makeButton(t.id, false), ref);
      } else if (t.mode === 'after') {
        field.insertAdjacentElement('afterend', makeButton(t.id, false));
      } else {
        const label = field.closest('label') || document.querySelector('label[for="' + t.id + '"]');
        if (label) label.insertBefore(makeButton(t.id, true), label.firstChild);
      }
    });
  }

  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }

  function init() {
    injectStyle(); scan();
    new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
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
