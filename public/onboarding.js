(function (root) {
  'use strict';

  const HINT_DEFS = {
    'cmd-center': {
      title: 'Quick jump with Ctrl+K',
      body: 'Open Global Command Center anytime to search tasks, notes, calendar blocks, and actions.',
    },
    'sidebar-compact': {
      title: 'Compact Sidebar Rail',
      body: 'Collapse navigation into a slim icon rail using the sidebar toggle button (⇄) for extra workspace room.',
    },
    'pin-nav': {
      title: 'Pin Favorite Destinations',
      body: 'Pin up to 6 views to keep quick-access chips at the top of your sidebar.',
    },
    'dash-customize': {
      title: 'Customize Dashboard Cards',
      body: 'Drag dashboard cards to reorder them, or toggle Standard, Compact, and Wide layouts.',
    },
    'settings-search': {
      title: 'Instant Settings Search',
      body: 'Type any keyword in the Settings search bar to filter controls across all categories.',
    },
    'focus-mode': {
      title: 'Distraction-Free Focus Mode',
      body: 'Press Alt+F anytime to hide sidebars and surface a minimal sticky timer bar.',
    },
  };

  let adapter = null;
  let bootedAt = Date.now();
  let viewNavCount = 0;
  let baselinePrefs = null;
  let selectedPresetId = 'balanced';
  let previewedPresetId = null;
  let welcomeManual = false;
  let tourActive = false;
  let tourIndex = 0;
  let tourOpenerEl = null;
  let tourOpenedDrawer = false;
  let activeHintId = null;
  let tourResizeHandler = null;
  let tourKeyHandler = null;

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('nex-onboarding-styles')) return;
    const style = document.createElement('style');
    style.id = 'nex-onboarding-styles';
    style.textContent = `
      .nex-welcome-card {
        position: relative;
        margin-bottom: 18px;
        padding: 20px 22px;
        border-radius: var(--radius-lg, 18px);
        background: var(--bg-surface, var(--surface, #1e1b26));
        border: 1px solid var(--border-medium, var(--outline, rgba(148,163,184,.28)));
        box-shadow: var(--shadow-md, 0 12px 32px rgba(0,0,0,.22));
        color: var(--text-main, var(--text, #f8fafc));
      }
      .nex-welcome-card[hidden] { display: none !important; }
      .nex-welcome-head {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 14px;
      }
      #nex-welcome-later-btn { margin-left: auto; flex-shrink: 0; }
      .nex-welcome-badge {
        display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px;
        font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        background: rgba(139,92,246,.16); color: var(--accent-primary, var(--accent, #8b5cf6));
        margin-bottom: 6px;
      }
      .nex-welcome-title { font-family: var(--font-display, inherit); font-size: 19px; font-weight: 700; margin: 0 0 4px; }
      .nex-welcome-sub { font-size: 13px; color: var(--text-secondary, var(--text-2, #94a3b8)); margin: 0; max-width: 640px; }
      .nex-welcome-grid {
        display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px;
      }
      @media (max-width: 1024px) { .nex-welcome-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 560px) { .nex-welcome-grid { grid-template-columns: 1fr; } .nex-welcome-card { padding: 16px; } }
      .nex-wchoice {
        display: flex; flex-direction: column; gap: 8px; padding: 12px; text-align: left; cursor: pointer;
        border-radius: var(--radius-md, 14px);
        border: 1.5px solid var(--border-subtle, var(--outline, rgba(148,163,184,.2)));
        background: var(--bg-card, var(--surface-2, rgba(255,255,255,.04)));
        color: inherit; font: inherit; transition: border-color .16s ease, background .16s ease, transform .14s ease;
      }
      .nex-wchoice:hover { border-color: var(--border-medium, var(--outline-strong, rgba(148,163,184,.45))); background: var(--bg-card-hover, rgba(255,255,255,.07)); }
      .nex-wchoice.selected {
        border-color: var(--accent-primary, var(--accent, #8b5cf6));
        background: var(--bg-card-active, rgba(139,92,246,.14));
        box-shadow: 0 0 0 1px var(--accent-primary, var(--accent, #8b5cf6));
      }
      .nex-wprev {
        display: grid; grid-template-columns: 18px 1fr; grid-template-rows: 8px 1fr; gap: 4px;
        height: 44px; padding: 5px; border-radius: 8px;
        background: var(--bg-app, var(--bg, rgba(15,23,42,.4)));
        border: 1px solid var(--border-subtle, var(--outline, rgba(148,163,184,.18)));
      }
      .nex-wprev.is-rail { grid-template-columns: 8px 1fr; }
      .nex-wprev i { display: block; border-radius: 3px; background: var(--border-medium, rgba(148,163,184,.35)); }
      .nex-wprev i:first-child { grid-row: 1 / 3; background: var(--accent-primary, var(--accent, #8b5cf6)); opacity: .65; }
      .nex-wchoice-title { font-size: 13.5px; font-weight: 700; line-height: 1.25; }
      .nex-wchoice-desc { font-size: 11.5px; line-height: 1.4; color: var(--text-secondary, var(--text-2, #94a3b8)); flex: 1; }
      .nex-wchoice-tags { display: flex; flex-wrap: wrap; gap: 4px; font-size: 10.5px; color: var(--text-muted, var(--text-3, #94a3b8)); }
      .nex-wchoice-tags span {
        padding: 2px 6px; border-radius: 999px;
        background: var(--bg-surface-elevated, var(--surface, rgba(255,255,255,.06)));
        border: 1px solid var(--border-subtle, var(--outline, rgba(148,163,184,.18)));
      }
      .nex-welcome-foot {
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
      }
      .nex-welcome-acts { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .nex-welcome-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        min-height: 36px; padding: 7px 14px; border-radius: 999px; cursor: pointer;
        font: inherit; font-size: 12.5px; font-weight: 600;
        border: 1px solid var(--border-medium, var(--outline-strong, rgba(148,163,184,.3)));
        background: var(--bg-card, var(--surface-2, transparent)); color: var(--text-main, var(--text, inherit));
      }
      .nex-welcome-btn:hover { background: var(--bg-card-hover, rgba(148,163,184,.12)); }
      .nex-welcome-btn.primary {
        border-color: transparent;
        background: var(--accent-primary, var(--accent, #8b5cf6));
        color: var(--text-on-accent, var(--on-accent, #ffffff));
      }
      .nex-welcome-btn.ghost { border-color: transparent; background: transparent; color: var(--text-secondary, var(--text-2, #94a3b8)); }

      .nex-tour-highlight {
        position: fixed; z-index: 9995; pointer-events: none; border-radius: 12px;
        border: 2px solid var(--accent-primary, var(--accent, #8b5cf6));
        box-shadow: 0 0 0 4px rgba(139,92,246,.22), 0 8px 28px rgba(0,0,0,.35);
        transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease;
      }
      .nex-tour-card {
        position: fixed; z-index: 10000; width: min(360px, calc(100vw - 24px));
        padding: 16px 18px; border-radius: 16px;
        background: var(--bg-surface, var(--surface, #1e1b26));
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        border: 1px solid var(--border-medium, var(--outline-strong, rgba(148,163,184,.35)));
        box-shadow: 0 18px 48px rgba(0,0,0,.42);
        color: var(--text-main, var(--text, #f8fafc));
      }
      .nex-tour-step { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--accent-primary, var(--accent, #8b5cf6)); margin-bottom: 4px; }
      .nex-tour-title { font-family: var(--font-display, inherit); font-size: 16px; font-weight: 700; margin: 0 0 6px; }
      .nex-tour-body { font-size: 13px; line-height: 1.5; color: var(--text-secondary, var(--text-2, #cbd5e1)); margin: 0 0 14px; }
      .nex-tour-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .nex-tour-nav { display: flex; gap: 6px; align-items: center; }

      .nex-hint-pill {
        position: fixed; z-index: 2450; right: 20px; bottom: 24px; width: min(340px, calc(100vw - 24px));
        padding: 12px 14px; border-radius: 14px;
        background: var(--bg-surface, var(--surface, #1e1b26));
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        border: 1px solid var(--border-medium, var(--outline-strong, rgba(148,163,184,.3)));
        box-shadow: 0 12px 30px rgba(0,0,0,.32);
        color: var(--text-main, var(--text, #f8fafc));
        font-size: 12.5px; line-height: 1.45;
      }
      .nex-hint-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-weight: 700; }
      .nex-hint-acts { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .nex-hint-link {
        border: 0; background: transparent; padding: 3px 6px; border-radius: 6px; cursor: pointer;
        font: inherit; font-size: 11.5px; font-weight: 600; color: var(--accent-primary, var(--accent, #8b5cf6));
      }
      .nex-hint-link.muted { color: var(--text-muted, var(--text-3, #94a3b8)); margin-left: auto; }
      #ent-welcome-host[hidden], #classic-welcome-host[hidden] { display: none !important; }
      @media (max-width: 900px) {
        .nex-hint-pill { left: 12px; right: 12px; bottom: calc(78px + env(safe-area-inset-bottom, 0px)); width: auto; }
      }
      html[data-reduced-motion="1"] .nex-tour-highlight,
      html[data-reduced-motion="1"] .nex-wchoice { transition: none !important; }
      @media (prefers-reduced-motion: reduce) {
        .nex-tour-highlight, .nex-wchoice { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function reducedMotion() {
    if (typeof document === 'undefined') return false;
    return document.documentElement.getAttribute('data-reduced-motion') === '1'
      || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getAdaptive() {
    return root.NexAdaptive || null;
  }

  function getPrefs() {
    return adapter && typeof adapter.getPrefs === 'function' ? adapter.getPrefs() : null;
  }

  function saveOnboardingPatch(patch, extra) {
    const A = getAdaptive();
    const cur = getPrefs();
    if (!A || !cur || !adapter || typeof adapter.commitPrefs !== 'function') return cur;
    const prevOb = cur.onboarding || {};
    const next = {
      ...cur,
      ...(extra && extra.preserveProfileId ? {} : {}),
      onboarding: {
        ...prevOb,
        ...patch,
      },
    };
    return adapter.commitPrefs(next, { ...(extra || {}), preserveTimestamp: false });
  }

  function presetPreviewTags(p) {
    const sb = p.sidebarMode === 'compact' ? 'Compact rail' : 'Expanded sidebar';
    const focusMin = p.timer && p.timer.focus ? `${p.timer.focus}m sprints` : '25m sprints';
    const density = (p.density || 'comfortable').replace(/^\w/, c => c.toUpperCase());
    return [sb, focusMin, density];
  }

  function welcomePresetCardsHtml(chosenId) {
    const A = getAdaptive();
    if (!A || !A.PRESETS) return '';
    const order = ['balanced', 'study', 'deep-work', 'minimal'];
    return order.map((id) => {
      const p = A.PRESETS[id];
      if (!p) return '';
      const isSelected = chosenId === id;
      const tags = presetPreviewTags(p);
      return `<button type="button" class="nex-wchoice${isSelected ? ' selected' : ''}" role="radio" aria-checked="${isSelected}" data-welcome-preset="${id}" onclick="NexOnboarding.selectPreset('${id}')">
        <span class="nex-wprev${p.sidebarMode === 'compact' ? ' is-rail' : ''}" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="nex-wchoice-title">${esc(p.label)}</span>
        <span class="nex-wchoice-desc">${esc(p.summary)}</span>
        <span class="nex-wchoice-tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</span>
      </button>`;
    }).join('');
  }

  function hideLegacyQuickStartBanner(hide) {
    if (!adapter || adapter.surface !== 'enterprise') return;
    const qs = document.getElementById('qs-card');
    if (qs && hide) qs.hidden = true;
  }

  function renderWelcomeCard(opts) {
    if (typeof document === 'undefined' || !adapter) return;
    ensureStyles();
    const prefs = getPrefs();
    const manual = Boolean(opts && opts.manual);
    const fromPreview = Boolean(opts && opts.fromPreview);
    welcomeManual = manual;

    const host = document.getElementById(adapter.surface === 'enterprise' ? 'ent-welcome-host' : 'classic-welcome-host');
    if (!host) return;

    const ctx = typeof adapter.contextSnapshot === 'function' ? adapter.contextSnapshot() : {};
    const A = getAdaptive();
    const offerAuto = !manual && A && typeof A.shouldOfferWelcome === 'function' && A.shouldOfferWelcome({ ...ctx, prefs });
    if (!manual && !fromPreview && !offerAuto) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }

    if (!baselinePrefs && prefs) baselinePrefs = JSON.parse(JSON.stringify(prefs));
    if (!previewedPresetId) selectedPresetId = (prefs && prefs.profileId && A && A.PRESETS[prefs.profileId]) ? prefs.profileId : 'balanced';

    host.hidden = false;
    host.innerHTML = `<section class="nex-welcome-card" id="nex-welcome-card" role="region" aria-label="Workspace onboarding setup">
      <div class="nex-welcome-head">
        <div>
          <span class="nex-welcome-badge">Welcome to NexOS</span>
          <h3 class="nex-welcome-title">Choose a starting workspace</h3>
          <p class="nex-welcome-sub">Click any workspace to preview its layout, sidebar, and timer live. Nothing existing is ever deleted, and you can customize everything later in Settings.</p>
        </div>
        <button type="button" class="nex-welcome-btn ghost" id="nex-welcome-later-btn" onclick="NexOnboarding.dismissWelcome('later')">Later</button>
      </div>
      <div class="nex-welcome-grid" role="radiogroup" aria-label="Workspace presets">
        ${welcomePresetCardsHtml(selectedPresetId)}
      </div>
      <div class="nex-welcome-foot">
        <span class="nex-wchoice-desc" id="nex-welcome-preview-note" style="flex:0 1 auto">${previewedPresetId ? `Previewing <strong>${esc(A.PRESETS[previewedPresetId]?.label || selectedPresetId)}</strong> — choose Finish to save or Skip to cancel preview.` : 'Select any card to preview live.'}</span>
        <div class="nex-welcome-acts">
          <button type="button" class="nex-welcome-btn ghost" id="nex-welcome-skip-btn" onclick="NexOnboarding.dismissWelcome('skip')">Skip</button>
          <button type="button" class="nex-welcome-btn" id="nex-welcome-tour-btn" onclick="NexOnboarding.continueToTour()">Continue to Tour</button>
          <button type="button" class="nex-welcome-btn primary" id="nex-welcome-finish-btn" onclick="NexOnboarding.finishWelcome()">Finish</button>
        </div>
      </div>
    </section>`;
    hideLegacyQuickStartBanner(true);
  }

  function selectPreset(presetId) {
    const A = getAdaptive();
    const cur = getPrefs();
    if (!A || !A.PRESETS[presetId] || !cur || !adapter) return;
    if (!baselinePrefs) baselinePrefs = JSON.parse(JSON.stringify(cur));
    selectedPresetId = presetId;
    previewedPresetId = presetId;
    const nextPreview = A.applyPreset(presetId, cur);
    if (typeof adapter.previewPrefs === 'function') {
      adapter.previewPrefs(nextPreview);
    } else {
      adapter.commitPrefs(nextPreview, { skipSave: true });
    }
    const card = typeof document !== 'undefined' ? document.getElementById('nex-welcome-card') : null;
    if (card) {
      card.querySelectorAll('[data-welcome-preset]').forEach((btn) => {
        const on = btn.getAttribute('data-welcome-preset') === presetId;
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-checked', String(on));
      });
      const note = document.getElementById('nex-welcome-preview-note');
      if (note) {
        note.innerHTML = `Previewing <strong>${esc(A.PRESETS[presetId]?.label || presetId)}</strong> — choose Finish to save or Skip to cancel preview.`;
      }
    } else {
      renderWelcomeCard({ manual: welcomeManual, fromPreview: true });
    }
  }

  function commitSelectedWelcome(extraOnboarding) {
    const A = getAdaptive();
    const cur = getPrefs();
    const nextPrefs = A.applyPreset(selectedPresetId, baselinePrefs || cur || {});
    nextPrefs.onboarding = {
      ...((cur && cur.onboarding) || {}),
      welcomeCompleted: true,
      ...extraOnboarding,
    };
    const isEmpty = typeof adapter.isWorkspaceEmpty === 'function' ? adapter.isWorkspaceEmpty() : false;
    if (!welcomeManual && isEmpty && typeof adapter.seedEmptyWorkspace === 'function') {
      adapter.seedEmptyWorkspace(selectedPresetId);
    }
    baselinePrefs = null;
    previewedPresetId = null;
    adapter.commitPrefs(nextPrefs, { renderControls: true });
    const host = document.getElementById(adapter.surface === 'enterprise' ? 'ent-welcome-host' : 'classic-welcome-host');
    if (host) { host.innerHTML = ''; host.hidden = true; }
    if (typeof adapter.toast === 'function') {
      adapter.toast(`${A.PRESETS[selectedPresetId]?.label || 'Workspace'} applied.`);
    }
  }

  function finishWelcome() {
    commitSelectedWelcome({});
  }

  function continueToTour() {
    commitSelectedWelcome({});
    startTour({ surface: adapter.surface });
  }

  function dismissWelcome(kind) {
    const A = getAdaptive();
    const base = baselinePrefs || getPrefs();
    const next = A ? A.sanitizePrefs(base) : base;
    if (next) {
      next.onboarding = {
        ...(next.onboarding || {}),
        welcomeCompleted: true,
        welcomeSkippedAt: Date.now(),
      };
      if (typeof adapter.commitPrefs === 'function') {
        adapter.commitPrefs(next, { renderControls: true, restoreBaseline: Boolean(previewedPresetId) });
      }
    }
    baselinePrefs = null;
    previewedPresetId = null;
    const host = document.getElementById(adapter && adapter.surface === 'enterprise' ? 'ent-welcome-host' : 'classic-welcome-host');
    if (host) { host.innerHTML = ''; host.hidden = true; }
    if (typeof adapter?.toast === 'function') {
      adapter.toast(kind === 'later' ? 'Setup saved for later. Open it anytime in Settings.' : 'Onboarding skipped. All features remain ready.');
    }
  }

  function tourStepsForSurface(surface) {
    if (surface === 'classic') {
      return [
        {
          id: 'dashboard',
          title: 'Dashboard Overview',
          body: 'Your home base summarizes open tasks, focus minutes, daily habits, and recent notes with customizable widgets.',
          getTarget: () => document.querySelector('#view-dashboard .stats-grid') || document.getElementById('view-dashboard'),
          prepare: () => { if (typeof switchView === 'function') switchView('dashboard'); },
        },
        {
          id: 'sidebar',
          title: 'Two-Group Sidebar Navigation',
          body: 'Sidebar views are organized cleanly under Workspace and Focus & Growth. Click headings to collapse, or click the sidebar button to switch to a compact icon rail.',
          needDrawer: true,
          getTarget: () => document.getElementById('classic-sidebar-nav') || document.getElementById('sidebar'),
        },
        {
          id: 'cmd',
          title: 'Global Command Center (Ctrl+K)',
          body: 'Search across tasks, notes, habits, and quick actions from anywhere using Ctrl+K (or Cmd+K on Mac).',
          getTarget: () => document.querySelector('.topbar-search'),
        },
        {
          id: 'tasks',
          title: 'Tasks & Planning',
          body: 'Organize tasks on the Kanban board or click Plan my day to map blocks onto your schedule.',
          needDrawer: true,
          getTarget: () => document.querySelector('#classic-sidebar-nav .nav-item[data-view="kanban"]'),
        },
        {
          id: 'focus-study',
          title: 'Focus & Study Studio',
          body: 'Run timed Pomodoro focus sprints or open full-screen Study Studio for AI Q&A, quizzes, flashcards, and mindmaps.',
          needDrawer: true,
          getTarget: () => document.getElementById('nav-study') || document.querySelector('#classic-sidebar-nav .nav-item[data-view="pomodoro"]'),
        },
        {
          id: 'settings',
          title: 'Settings & Personalization',
          body: 'Customize theme, density, navigation pins, keyboard shortcuts, and replay this tour anytime inside Settings.',
          needDrawer: true,
          getTarget: () => document.getElementById('nav-profile') || document.getElementById('top-avatar'),
        },
      ];
    }

    return [
      {
        id: 'dashboard',
        title: 'Enterprise Command Dashboard',
        body: 'Monitor priorities, focus minutes, habit streaks, and customize cards using Balanced, Study, Deep Work, or Minimal presets.',
        getTarget: () => document.querySelector('#pane-dashboard .kpi-grid') || document.getElementById('pane-dashboard'),
        prepare: () => { if (typeof switchNexusView === 'function') switchNexusView('dashboard'); },
      },
      {
        id: 'sidebar',
        title: 'Two Expandable Sidebar Groups',
        body: 'Navigation is streamlined into two inline groups: Workspace (Dashboard, Kanban Board) and Productivity (Deep Focus, Habit Mastery, Smart Notes, Analytics, Timeblocking, Study Studio, NexAI).',
        needDrawer: true,
        getTarget: () => document.getElementById('ent-sidebar-nav') || document.getElementById('app-sidebar'),
        prepare: () => {
          const prefs = getPrefs();
          if (prefs && (prefs.navigation.collapsedGroups || []).length) {
            const A = getAdaptive();
            if (A && adapter?.commitPrefs) {
              adapter.commitPrefs({ ...prefs, navigation: { ...prefs.navigation, collapsedGroups: [] } }, { skipSave: true });
            }
          }
        },
      },
      {
        id: 'cmd',
        title: 'Global Command Center (Ctrl+K)',
        body: 'Press Ctrl+K (or Cmd+K) anywhere to search tasks, calendar blocks, notes, study docs, and instant workspace actions.',
        getTarget: () => document.querySelector('.omni-search-trigger'),
      },
      {
        id: 'calendar',
        title: 'Kanban Board & Timeblocking',
        body: 'Organize sprint tasks on the Kanban Board and use Timeblocking to map tasks directly onto hourly calendar blocks.',
        needDrawer: true,
        getTarget: () => document.querySelector('#ent-sidebar-nav [data-view="calendar"]') || document.getElementById('ent-grp-list-workspace'),
      },
      {
        id: 'study-focus',
        title: 'Deep Focus & Study Studio',
        body: 'Launch Pomodoro sprints with ambient soundscapes or enter full-viewport Study Studio for grounded tutoring, quizzes, cards, and mindmaps.',
        needDrawer: true,
        getTarget: () => document.getElementById('nav-study') || document.querySelector('#ent-sidebar-nav [data-view="focus"]'),
      },
      {
        id: 'settings',
        title: 'Settings & Workspace Control',
        body: 'Open Settings to adjust themes, compact sidebar mode, pinned links, accessibility scales, or replay onboarding anytime.',
        needDrawer: true,
        getTarget: () => document.getElementById('ent-sb-settings-btn'),
      },
    ];
  }

  function removeTourNodes() {
    document.getElementById('nex-tour-highlight')?.remove();
    document.getElementById('nex-tour-card')?.remove();
    if (tourResizeHandler) {
      window.removeEventListener('resize', tourResizeHandler);
      window.removeEventListener('scroll', tourResizeHandler, true);
      tourResizeHandler = null;
    }
    if (tourKeyHandler) {
      document.removeEventListener('keydown', tourKeyHandler, true);
      tourKeyHandler = null;
    }
    if (tourOpenedDrawer && adapter && typeof adapter.closeDrawer === 'function') {
      adapter.closeDrawer();
    }
    tourOpenedDrawer = false;
  }

  function positionTourStep() {
    if (!tourActive) return;
    const steps = tourStepsForSurface(adapter ? adapter.surface : 'enterprise');
    const step = steps[tourIndex];
    if (!step) return;

    const target = typeof step.getTarget === 'function' ? step.getTarget() : null;
    const hl = document.getElementById('nex-tour-highlight');
    const card = document.getElementById('nex-tour-card');
    if (!hl || !card) return;

    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const rect = target ? target.getBoundingClientRect() : null;
    const hasRect = Boolean(rect && rect.width > 4 && rect.height > 4);

    if (hasRect) {
      hl.hidden = false;
      const top = Math.max(4, Math.min(vh - 20, rect.top - 4));
      const left = Math.max(4, Math.min(vw - 20, rect.left - 4));
      const w = Math.min(vw - left - 4, rect.width + 8);
      const h = Math.min(vh - top - 4, rect.height + 8);
      hl.style.top = `${Math.round(top)}px`;
      hl.style.left = `${Math.round(left)}px`;
      hl.style.width = `${Math.max(24, Math.round(w))}px`;
      hl.style.height = `${Math.max(24, Math.round(h))}px`;
    } else {
      hl.hidden = true;
    }

    const cr = card.getBoundingClientRect();
    const cw = cr.width || Math.min(360, vw - 24);
    const ch = cr.height || 210;

    if (vw <= 768) {
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.width = 'auto';
      card.style.top = 'auto';
      card.style.bottom = 'calc(72px + env(safe-area-inset-bottom, 0px))';
      return;
    }

    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.width = `${Math.min(360, vw - 24)}px`;

    let leftPos = 24;
    let topPos = 84;
    if (hasRect) {
      // Place to right of sidebar targets if space exists; else below or above target cleanly inside viewport
      if (rect.right + 16 + cw <= vw - 12) {
        leftPos = rect.right + 14;
        topPos = Math.max(16, Math.min(vh - ch - 16, rect.top));
      } else if (rect.bottom + 14 + ch <= vh - 12) {
        topPos = rect.bottom + 14;
        leftPos = Math.max(12, Math.min(vw - cw - 12, rect.left));
      } else if (rect.top - 14 - ch >= 12) {
        topPos = rect.top - 14 - ch;
        leftPos = Math.max(12, Math.min(vw - cw - 12, rect.left));
      } else {
        leftPos = Math.max(12, Math.min(vw - cw - 12, (vw - cw) / 2));
        topPos = Math.max(12, vh - ch - 20);
      }
    }
    card.style.left = `${Math.round(leftPos)}px`;
    card.style.top = `${Math.round(topPos)}px`;
  }

  function renderTourStep() {
    if (!tourActive || !adapter) return;
    ensureStyles();
    const steps = tourStepsForSurface(adapter.surface);
    const step = steps[tourIndex];
    if (!step) { finishTour(); return; }

    if (typeof step.prepare === 'function') {
      try { step.prepare(); } catch (_) {}
    }

    const isNarrow = adapter.isNarrow ? adapter.isNarrow() : window.innerWidth <= 992;
    if (step.needDrawer && isNarrow && typeof adapter.openDrawer === 'function') {
      adapter.openDrawer();
      tourOpenedDrawer = true;
    } else if (!step.needDrawer && tourOpenedDrawer && typeof adapter.closeDrawer === 'function') {
      adapter.closeDrawer();
      tourOpenedDrawer = false;
    }

    let hl = document.getElementById('nex-tour-highlight');
    if (!hl) {
      hl = document.createElement('div');
      hl.id = 'nex-tour-highlight';
      hl.className = 'nex-tour-highlight';
      hl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hl);
    }

    let card = document.getElementById('nex-tour-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'nex-tour-card';
      card.className = 'nex-tour-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'false');
      card.setAttribute('aria-labelledby', 'nex-tour-title');
      document.body.appendChild(card);
    }

    const total = steps.length;
    const isFirst = tourIndex === 0;
    const isLast = tourIndex === total - 1;
    card.innerHTML = `
      <div class="nex-tour-step">Product Tour · Step ${tourIndex + 1} of ${total}</div>
      <h4 class="nex-tour-title" id="nex-tour-title">${esc(step.title)}</h4>
      <p class="nex-tour-body">${esc(step.body)}</p>
      <div class="nex-tour-foot">
        <button type="button" class="nex-welcome-btn ghost" id="nex-tour-skip-btn" onclick="NexOnboarding.skipTour()">Skip</button>
        <div class="nex-tour-nav">
          <button type="button" class="nex-welcome-btn" id="nex-tour-prev-btn" onclick="NexOnboarding.prevTourStep()" ${isFirst ? 'disabled' : ''}>Previous</button>
          ${isLast
            ? '<button type="button" class="nex-welcome-btn primary" id="nex-tour-finish-btn" onclick="NexOnboarding.finishTour()">Finish</button>'
            : '<button type="button" class="nex-welcome-btn primary" id="nex-tour-next-btn" onclick="NexOnboarding.nextTourStep()">Next</button>'}
        </div>
      </div>
    `;

    const target = typeof step.getTarget === 'function' ? step.getTarget() : null;
    if (target && typeof target.scrollIntoView === 'function') {
      try { target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) {}
    }

    positionTourStep();
    setTimeout(positionTourStep, reducedMotion() ? 20 : 180);

    const focusTarget = document.getElementById(isLast ? 'nex-tour-finish-btn' : 'nex-tour-next-btn') || card;
    try { focusTarget.focus({ preventScroll: true }); } catch (_) {}
  }

  function startTour(opts) {
    if (!adapter && opts && opts.surface) return;
    dismissActiveHint(false);
    tourOpenerEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (adapter && typeof adapter.closeModalsForTour === 'function') adapter.closeModalsForTour();
    tourActive = true;
    tourIndex = 0;

    removeTourNodes();
    tourResizeHandler = () => positionTourStep();
    tourKeyHandler = (e) => {
      if (!tourActive) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        skipTour();
      } else if (e.key === 'ArrowRight' && document.activeElement?.closest('#nex-tour-card')) {
        e.preventDefault();
        if (tourIndex < tourStepsForSurface(adapter.surface).length - 1) nextTourStep();
      } else if (e.key === 'ArrowLeft' && document.activeElement?.closest('#nex-tour-card')) {
        e.preventDefault();
        if (tourIndex > 0) prevTourStep();
      }
    };
    window.addEventListener('resize', tourResizeHandler);
    window.addEventListener('scroll', tourResizeHandler, true);
    document.addEventListener('keydown', tourKeyHandler, true);

    renderTourStep();
  }

  function nextTourStep() {
    const total = tourStepsForSurface(adapter ? adapter.surface : 'enterprise').length;
    if (tourIndex < total - 1) {
      tourIndex++;
      renderTourStep();
    } else {
      finishTour();
    }
  }

  function prevTourStep() {
    if (tourIndex > 0) {
      tourIndex--;
      renderTourStep();
    }
  }

  function endTourAndRestoreFocus(patch) {
    tourActive = false;
    removeTourNodes();
    saveOnboardingPatch(patch, { renderControls: true });
    const fallbackEl = typeof document !== 'undefined'
      ? document.getElementById(adapter && adapter.surface === 'classic' ? 'top-avatar' : 'ent-sb-settings-btn')
      : null;
    const targetEl = (tourOpenerEl && tourOpenerEl.isConnected && tourOpenerEl.offsetParent !== null) ? tourOpenerEl : fallbackEl;
    if (targetEl && typeof targetEl.focus === 'function') {
      try { targetEl.focus({ preventScroll: true }); } catch (_) {}
    }
    tourOpenerEl = null;
  }

  function finishTour() {
    endTourAndRestoreFocus({ welcomeCompleted: true, tourCompleted: true });
    if (adapter && typeof adapter.toast === 'function') {
      adapter.toast('Product tour complete. Replay anytime from Settings.');
    }
  }

  function skipTour() {
    endTourAndRestoreFocus({ welcomeCompleted: true, tourSkippedAt: Date.now() });
  }

  function dismissActiveHint(persist = true) {
    const hid = activeHintId;
    activeHintId = null;
    if (typeof document !== 'undefined') document.getElementById('nex-hint-pill')?.remove();
    if (persist && hid) {
      const cur = getPrefs();
      const prev = cur?.onboarding?.dismissedHints || [];
      if (!prev.includes(hid)) {
        saveOnboardingPatch({ dismissedHints: [...prev, hid] }, { renderControls: true });
      }
    }
  }

  function neverShowHintsAgain() {
    activeHintId = null;
    if (typeof document !== 'undefined') document.getElementById('nex-hint-pill')?.remove();
    saveOnboardingPatch({ neverShowHints: true }, { renderControls: true });
    if (adapter && typeof adapter.toast === 'function') {
      adapter.toast('Feature discovery tips turned off. You can re-enable them in Settings.');
    }
  }

  function maybeShowHint(hintId, opts) {
    if (typeof document === 'undefined' || !adapter || tourActive) return false;
    if (document.getElementById('nex-welcome-card')) return false;
    const def = HINT_DEFS[hintId];
    const prefs = getPrefs();
    if (!def || !prefs) return false;
    const ob = prefs.onboarding || {};
    if (ob.neverShowHints) return false;
    if (Array.isArray(ob.dismissedHints) && ob.dismissedHints.includes(hintId)) return false;
    if (!(opts && opts.immediate) && Date.now() - bootedAt < 2500) return false;
    if (activeHintId) return false;

    ensureStyles();
    activeHintId = hintId;
    const el = document.createElement('aside');
    el.id = 'nex-hint-pill';
    el.className = 'nex-hint-pill';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="nex-hint-head">
        <span>💡 ${esc(def.title)}</span>
        <button type="button" class="nex-hint-link" onclick="NexOnboarding.dismissActiveHint(true)" aria-label="Dismiss tip">✕</button>
      </div>
      <div>${esc(def.body)}</div>
      <div class="nex-hint-acts">
        <button type="button" class="nex-hint-link" onclick="NexOnboarding.dismissActiveHint(true)">Got it</button>
        <button type="button" class="nex-hint-link muted" onclick="NexOnboarding.neverShowHintsAgain()">Never show tips</button>
      </div>
    `;
    document.body.appendChild(el);
    return true;
  }

  function notifySignal(eventName, detail) {
    if (!adapter) return;
    if (eventName === 'view-switch') {
      viewNavCount++;
      if (detail === 'focus' && Date.now() - bootedAt > 2500) maybeShowHint('focus-mode');
      else if (viewNavCount >= 4 && Date.now() - bootedAt > 2500) maybeShowHint('sidebar-compact');
    } else if (eventName === 'settings-tab') {
      if (detail === 'navigation') maybeShowHint('pin-nav', { immediate: true });
      else maybeShowHint('settings-search');
    } else if (eventName === 'dash-customize') {
      maybeShowHint('dash-customize', { immediate: true });
    } else if (eventName === 'cmd-used') {
      const cur = getPrefs();
      const prev = cur?.onboarding?.dismissedHints || [];
      if (cur && !prev.includes('cmd-center')) {
        saveOnboardingPatch({ dismissedHints: [...prev, 'cmd-center'] }, { skipSave: true });
      }
      if (activeHintId === 'cmd-center') dismissActiveHint(true);
    }
  }

  function init(cfg) {
    adapter = cfg;
    bootedAt = Date.now();
    renderWelcomeCard({ manual: false });
  }

  function resetDismissedHints() {
    saveOnboardingPatch({ dismissedHints: [], neverShowHints: false }, { renderControls: true });
    if (adapter && typeof adapter.toast === 'function') adapter.toast('Feature discovery tips reset.');
  }

  function toggleTipsEnabled(enabled) {
    saveOnboardingPatch({ neverShowHints: !enabled }, { renderControls: true });
  }

  const api = {
    HINT_DEFS,
    init,
    renderWelcomeCard,
    openWelcome: () => renderWelcomeCard({ manual: true }),
    selectPreset,
    finishWelcome,
    continueToTour,
    dismissWelcome,
    startTour,
    nextTourStep,
    prevTourStep,
    finishTour,
    skipTour,
    maybeShowHint,
    dismissActiveHint,
    neverShowHintsAgain,
    resetDismissedHints,
    toggleTipsEnabled,
    notifySignal,
    isTourActive: () => tourActive,
    isReady: () => Boolean(adapter),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexOnboarding = api;
})(typeof window !== 'undefined' ? window : globalThis);
