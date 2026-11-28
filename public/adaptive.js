(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const VIEW_IDS = ['dashboard', 'kanban', 'focus', 'habits', 'notes', 'analytics', 'calendar', 'study', 'ai'];
  const WIDGET_IDS = ['tasks', 'pomodoro', 'habits', 'notes'];
  const WIDGET_SIZES = ['compact', 'normal', 'wide'];
  const DENSITIES = ['compact', 'comfortable', 'spacious'];
  const TEXT_SCALES = [90, 100, 110, 120];
  const ACCENT_PRESETS = ['theme', 'cobalt', 'emerald', 'violet', 'amber'];
  const SIDEBAR_MODES = ['expanded', 'compact'];
  const GROUP_IDS = ['workspace', 'growth'];

  const PRESETS = {
    balanced: {
      id: 'balanced',
      label: 'Balanced Workspace',
      summary: 'All core modules balanced with comfortable spacing and expanded navigation.',
      landingView: 'dashboard',
      startupBehavior: 'landing',
      density: 'comfortable',
      textScale: 100,
      accentPreset: 'theme',
      reducedMotion: false,
      highContrast: false,
      focusHighlight: 'standard',
      minimalChrome: false,
      focusEmphasis: true,
      widgets: ['tasks', 'pomodoro', 'habits', 'notes'],
      hiddenWidgets: [],
      widgetSizes: { tasks: 'normal', pomodoro: 'normal', habits: 'normal', notes: 'normal' },
      sidebarMode: 'expanded',
      pinned: ['dashboard', 'kanban', 'notes'],
      hiddenNav: [],
      navOrder: [...VIEW_IDS],
      collapsedGroups: [],
      mobilePrimary: ['dashboard', 'kanban', 'focus', 'notes'],
      timer: { focus: 25, short: 5, long: 15 },
    },
    'deep-work': {
      id: 'deep-work',
      label: 'Deep Work Workspace',
      summary: 'Focus & Tasks first with compact sidebar, 50m deep sessions, and low distraction.',
      landingView: 'dashboard',
      startupBehavior: 'landing',
      density: 'compact',
      textScale: 100,
      accentPreset: 'cobalt',
      reducedMotion: false,
      highContrast: false,
      focusHighlight: 'strong',
      minimalChrome: false,
      focusEmphasis: true,
      widgets: ['pomodoro', 'tasks', 'notes', 'habits'],
      hiddenWidgets: ['habits'],
      widgetSizes: { tasks: 'normal', pomodoro: 'wide', habits: 'normal', notes: 'normal' },
      sidebarMode: 'compact',
      pinned: ['focus', 'kanban', 'notes'],
      hiddenNav: [],
      navOrder: ['focus', 'kanban', 'dashboard', 'notes', 'calendar', 'analytics', 'habits', 'study', 'ai'],
      collapsedGroups: [],
      mobilePrimary: ['focus', 'kanban', 'notes', 'dashboard'],
      timer: { focus: 50, short: 10, long: 20 },
    },
    study: {
      id: 'study',
      label: 'Study Workspace',
      summary: 'Surfaces Focus sessions, Smart Notes, Tasks, and pinned Study Studio shortcuts.',
      landingView: 'dashboard',
      startupBehavior: 'landing',
      density: 'comfortable',
      textScale: 100,
      accentPreset: 'violet',
      reducedMotion: false,
      highContrast: false,
      focusHighlight: 'standard',
      minimalChrome: false,
      focusEmphasis: true,
      widgets: ['pomodoro', 'notes', 'tasks', 'habits'],
      hiddenWidgets: [],
      widgetSizes: { tasks: 'normal', pomodoro: 'normal', habits: 'normal', notes: 'wide' },
      sidebarMode: 'expanded',
      pinned: ['study', 'focus', 'notes'],
      hiddenNav: [],
      navOrder: ['dashboard', 'study', 'focus', 'notes', 'kanban', 'habits', 'calendar', 'analytics', 'ai'],
      collapsedGroups: [],
      mobilePrimary: ['dashboard', 'study', 'focus', 'notes'],
      timer: { focus: 50, short: 10, long: 20 },
    },
    minimal: {
      id: 'minimal',
      label: 'Minimal Workspace',
      summary: 'Calm, spacious layout centered on Tasks and Notes with reduced chrome.',
      landingView: 'dashboard',
      startupBehavior: 'landing',
      density: 'spacious',
      textScale: 100,
      accentPreset: 'theme',
      reducedMotion: true,
      highContrast: false,
      focusHighlight: 'standard',
      minimalChrome: true,
      focusEmphasis: false,
      widgets: ['tasks', 'notes', 'pomodoro', 'habits'],
      hiddenWidgets: ['pomodoro', 'habits'],
      widgetSizes: { tasks: 'wide', pomodoro: 'normal', habits: 'normal', notes: 'normal' },
      sidebarMode: 'compact',
      pinned: ['dashboard', 'kanban', 'notes'],
      hiddenNav: ['analytics'],
      navOrder: ['dashboard', 'kanban', 'notes', 'focus', 'habits', 'calendar', 'study', 'ai', 'analytics'],
      collapsedGroups: ['growth'],
      mobilePrimary: ['dashboard', 'kanban', 'notes', 'ai'],
      timer: { focus: 25, short: 5, long: 15 },
    },
  };

  function canonicalViewId(v) {
    const raw = String(v || '').trim().toLowerCase();
    if (raw === 'pomodoro') return 'focus';
    if (raw === 'home') return 'dashboard';
    if (raw === 'tasks') return 'kanban';
    if (raw === 'insights') return 'analytics';
    return VIEW_IDS.includes(raw) ? raw : 'dashboard';
  }

  function toClassicViewId(canonical) {
    const v = canonicalViewId(canonical);
    if (v === 'focus') return 'pomodoro';
    if (v === 'calendar') return 'kanban';
    return v;
  }

  function uniqueList(list, allowed, requiredFallback) {
    const out = [];
    const seen = new Set();
    const allowSet = new Set(allowed);
    if (Array.isArray(list)) {
      for (const item of list) {
        const raw = String(item || '').trim().toLowerCase();
        const val = allowed === VIEW_IDS && raw === 'pomodoro' ? 'focus' : raw;
        if (allowSet.has(val) && !seen.has(val)) {
          seen.add(val);
          out.push(val);
        }
      }
    }
    if (Array.isArray(requiredFallback)) {
      for (const item of requiredFallback) {
        if (allowSet.has(item) && !seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }

  function buildDefaults(presetId) {
    const p = PRESETS[presetId] || PRESETS.balanced;
    return {
      v: SCHEMA_VERSION,
      updatedAt: 0,
      profileId: p.id,
      general: {
        landingView: p.landingView,
        startupBehavior: p.startupBehavior,
      },
      appearance: {
        accentPreset: p.accentPreset,
        textScale: p.textScale,
        interfaceDensity: p.density,
        reducedMotion: p.reducedMotion,
        highContrast: p.highContrast,
      },
      workspace: {
        widgets: p.widgets.slice(),
        hiddenWidgets: p.hiddenWidgets.slice(),
        widgetSizes: { ...p.widgetSizes },
        minimalChrome: p.minimalChrome,
        focusEmphasis: p.focusEmphasis,
      },
      navigation: {
        sidebarMode: p.sidebarMode,
        pinned: p.pinned.slice(),
        hidden: p.hiddenNav.slice(),
        order: p.navOrder.slice(),
        collapsedGroups: p.collapsedGroups.slice(),
        recent: ['dashboard'],
        mobilePrimary: p.mobilePrimary.slice(),
      },
      accessibility: {
        focusHighlight: p.focusHighlight,
      },
      focusMode: {
        autoZenOnStart: false,
      },
    };
  }

  function sanitizePrefs(raw, fallbackProfileId) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const validPresetIds = Object.keys(PRESETS).concat(['custom']);
    const fbId = PRESETS[fallbackProfileId] ? fallbackProfileId : 'balanced';
    const profileId = validPresetIds.includes(src.profileId) ? src.profileId : fbId;
    const base = buildDefaults(profileId === 'custom' ? fbId : profileId);

    const gen = src.general && typeof src.general === 'object' ? src.general : src;
    const app = src.appearance && typeof src.appearance === 'object' ? src.appearance : src;
    const ws = src.workspace && typeof src.workspace === 'object' ? src.workspace : src;
    const nav = src.navigation && typeof src.navigation === 'object' ? src.navigation : src;
    const a11y = src.accessibility && typeof src.accessibility === 'object' ? src.accessibility : src;
    const fm = src.focusMode && typeof src.focusMode === 'object' ? src.focusMode : {};

    const widgets = uniqueList(ws.widgets, WIDGET_IDS, WIDGET_IDS);
    const hiddenWidgets = uniqueList(ws.hiddenWidgets, WIDGET_IDS, []);
    const widgetSizes = { ...base.workspace.widgetSizes };
    if (ws.widgetSizes && typeof ws.widgetSizes === 'object') {
      for (const w of WIDGET_IDS) {
        if (WIDGET_SIZES.includes(ws.widgetSizes[w])) widgetSizes[w] = ws.widgetSizes[w];
      }
    }

    const navOrder = uniqueList(nav.order, VIEW_IDS, VIEW_IDS);
    const hiddenNav = uniqueList(nav.hidden, VIEW_IDS.filter(v => v !== 'dashboard'), []);
    const pinned = uniqueList(nav.pinned, VIEW_IDS, []).slice(0, 6);
    const collapsedGroups = uniqueList(nav.collapsedGroups, GROUP_IDS, []);
    const recent = uniqueList(nav.recent, VIEW_IDS, ['dashboard']).slice(0, 5);
    const mobileRaw = uniqueList(nav.mobilePrimary, VIEW_IDS, base.navigation.mobilePrimary);
    const mobilePrimary = mobileRaw.slice(0, 4);
    while (mobilePrimary.length < 4) {
      const fill = VIEW_IDS.find(v => !mobilePrimary.includes(v));
      if (!fill) break;
      mobilePrimary.push(fill);
    }

    const rawScale = Number(app.textScale);
    const textScale = TEXT_SCALES.includes(rawScale) ? rawScale : base.appearance.textScale;

    return {
      v: SCHEMA_VERSION,
      updatedAt: Number.isFinite(Number(src.updatedAt)) && Number(src.updatedAt) >= 0 ? Number(src.updatedAt) : 0,
      profileId,
      general: {
        landingView: canonicalViewId(gen.landingView || base.general.landingView),
        startupBehavior: gen.startupBehavior === 'last' ? 'last' : 'landing',
      },
      appearance: {
        accentPreset: ACCENT_PRESETS.includes(app.accentPreset) ? app.accentPreset : base.appearance.accentPreset,
        textScale,
        interfaceDensity: DENSITIES.includes(app.interfaceDensity) ? app.interfaceDensity : base.appearance.interfaceDensity,
        reducedMotion: typeof app.reducedMotion === 'boolean' ? app.reducedMotion : base.appearance.reducedMotion,
        highContrast: typeof app.highContrast === 'boolean' ? app.highContrast : base.appearance.highContrast,
      },
      workspace: {
        widgets,
        hiddenWidgets,
        widgetSizes,
        minimalChrome: typeof ws.minimalChrome === 'boolean' ? ws.minimalChrome : base.workspace.minimalChrome,
        focusEmphasis: typeof ws.focusEmphasis === 'boolean' ? ws.focusEmphasis : base.workspace.focusEmphasis,
      },
      navigation: {
        sidebarMode: SIDEBAR_MODES.includes(nav.sidebarMode) ? nav.sidebarMode : base.navigation.sidebarMode,
        pinned,
        hidden: hiddenNav,
        order: navOrder,
        collapsedGroups,
        recent,
        mobilePrimary,
      },
      accessibility: {
        focusHighlight: a11y.focusHighlight === 'strong' ? 'strong' : 'standard',
      },
      focusMode: {
        autoZenOnStart: Boolean(fm.autoZenOnStart),
      },
    };
  }

  function cloneTouch(prefs, markCustom) {
    const next = sanitizePrefs(prefs);
    next.updatedAt = Date.now();
    if (markCustom) next.profileId = 'custom';
    return next;
  }

  function applyPreset(presetIdOrPrefs, prevPrefsMaybe) {
    const swapped = presetIdOrPrefs && typeof presetIdOrPrefs === 'object' && typeof prevPrefsMaybe === 'string';
    const presetId = swapped ? prevPrefsMaybe : presetIdOrPrefs;
    const prevPrefs = swapped ? presetIdOrPrefs : prevPrefsMaybe;
    const cleanId = PRESETS[presetId] ? presetId : 'balanced';
    const next = buildDefaults(cleanId);
    const prev = sanitizePrefs(prevPrefs);
    next.updatedAt = Date.now();
    next.navigation.recent = prev.navigation.recent.slice(0, 5);
    return next;
  }

  function restoreDefaults() {
    const next = buildDefaults('balanced');
    next.updatedAt = Date.now();
    return next;
  }

  function moveWidget(prefs, widgetId, delta) {
    const next = cloneTouch(prefs, true);
    const arr = next.workspace.widgets;
    const idx = arr.indexOf(widgetId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= arr.length) return next;
    arr.splice(idx, 1);
    arr.splice(target, 0, widgetId);
    return next;
  }

  function reorderWidgetTo(prefs, fromId, toId) {
    const next = cloneTouch(prefs, true);
    const arr = next.workspace.widgets;
    const a = arr.indexOf(fromId);
    const b = arr.indexOf(toId);
    if (a < 0 || b < 0 || a === b) return next;
    arr.splice(a, 1);
    arr.splice(b, 0, fromId);
    return next;
  }

  function toggleWidgetHidden(prefs, widgetId, forceHidden) {
    const next = cloneTouch(prefs, true);
    if (!WIDGET_IDS.includes(widgetId)) return next;
    const set = new Set(next.workspace.hiddenWidgets);
    const shouldHide = typeof forceHidden === 'boolean' ? forceHidden : !set.has(widgetId);
    if (shouldHide) set.add(widgetId); else set.delete(widgetId);
    next.workspace.hiddenWidgets = [...set];
    return next;
  }

  function setWidgetSize(prefs, widgetId, size) {
    const next = cloneTouch(prefs, true);
    if (WIDGET_IDS.includes(widgetId) && WIDGET_SIZES.includes(size)) {
      next.workspace.widgetSizes[widgetId] = size;
    }
    return next;
  }

  function resetDashboardLayout(prefs) {
    const next = cloneTouch(prefs, false);
    const preset = PRESETS[next.profileId] || PRESETS.balanced;
    next.workspace.widgets = preset.widgets.slice();
    next.workspace.hiddenWidgets = [];
    next.workspace.widgetSizes = { tasks: 'normal', pomodoro: 'normal', habits: 'normal', notes: 'normal' };
    next.workspace.minimalChrome = preset.minimalChrome;
    return next;
  }

  function togglePin(prefs, viewId) {
    const v = canonicalViewId(viewId);
    const next = cloneTouch(prefs, true);
    const set = new Set(next.navigation.pinned);
    if (set.has(v)) set.delete(v);
    else if (set.size < 6) set.add(v);
    next.navigation.pinned = [...set];
    return next;
  }

  function toggleNavHidden(prefs, viewId) {
    const v = canonicalViewId(viewId);
    const next = cloneTouch(prefs, true);
    if (v === 'dashboard') return next; // Home cannot be hidden completely
    const set = new Set(next.navigation.hidden);
    if (set.has(v)) set.delete(v); else set.add(v);
    next.navigation.hidden = [...set];
    return next;
  }

  function moveNav(prefs, viewId, delta) {
    const v = canonicalViewId(viewId);
    const next = cloneTouch(prefs, true);
    const arr = next.navigation.order;
    const idx = arr.indexOf(v);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= arr.length) return next;
    arr.splice(idx, 1);
    arr.splice(target, 0, v);
    return next;
  }

  function toggleGroup(prefs, groupId) {
    const next = cloneTouch(prefs, false);
    if (!GROUP_IDS.includes(groupId)) return next;
    const set = new Set(next.navigation.collapsedGroups);
    if (set.has(groupId)) set.delete(groupId); else set.add(groupId);
    next.navigation.collapsedGroups = [...set];
    return next;
  }

  function setMobilePrimary(prefs, slotIndex, viewId) {
    const v = canonicalViewId(viewId);
    const next = cloneTouch(prefs, true);
    const arr = next.navigation.mobilePrimary.slice(0, 4);
    if (slotIndex < 0 || slotIndex > 3 || !VIEW_IDS.includes(v)) return next;
    const existing = arr.indexOf(v);
    if (existing >= 0 && existing !== slotIndex) {
      arr[existing] = arr[slotIndex];
    }
    arr[slotIndex] = v;
    next.navigation.mobilePrimary = uniqueList(arr, VIEW_IDS, PRESETS.balanced.mobilePrimary).slice(0, 4);
    return next;
  }

  function recordVisit(prefs, viewId) {
    const v = canonicalViewId(viewId);
    const prev = sanitizePrefs(prefs);
    const recent = [v, ...prev.navigation.recent.filter(x => x !== v)].slice(0, 4);
    if (prev.navigation.recent[0] === v) return prev;
    return { ...prev, navigation: { ...prev.navigation, recent } };
  }

  function resetNavigation(prefs) {
    const next = cloneTouch(prefs, false);
    const p = PRESETS[next.profileId] || PRESETS.balanced;
    next.navigation.sidebarMode = 'expanded';
    next.navigation.pinned = p.pinned.slice();
    next.navigation.hidden = [];
    next.navigation.order = [...VIEW_IDS];
    next.navigation.collapsedGroups = [];
    next.navigation.mobilePrimary = p.mobilePrimary.slice();
    return next;
  }

  function applyDocumentTokens(prefs, surface) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const p = sanitizePrefs(prefs);
    const el = document.documentElement;
    el.setAttribute('data-density', p.appearance.interfaceDensity);
    el.setAttribute('data-text-scale', String(p.appearance.textScale));
    el.setAttribute('data-reduced-motion', p.appearance.reducedMotion ? '1' : '0');
    el.setAttribute('data-contrast', p.appearance.highContrast ? 'high' : 'standard');
    el.setAttribute('data-focus-ring', p.accessibility.focusHighlight);
    el.setAttribute('data-accent', p.appearance.accentPreset);
    el.setAttribute('data-minimal', p.workspace.minimalChrome ? '1' : '0');
    el.style.setProperty('--nex-scale', String(p.appearance.textScale / 100));
    if (document.body) {
      document.body.classList.toggle('sidebar-compact', p.navigation.sidebarMode === 'compact');
      document.body.classList.toggle('nexos-minimal', p.workspace.minimalChrome);
      document.body.classList.toggle('nexos-reduced-motion', p.appearance.reducedMotion);
      document.body.classList.toggle('nexos-high-contrast', p.appearance.highContrast);
    }
    if (surface === 'enterprise') {
      const dSel = document.getElementById('density-selector');
      if (dSel) dSel.value = p.appearance.interfaceDensity;
    }
  }

  function devicePrefsKey(userIdentity) {
    const id = String(userIdentity || '').trim().toLowerCase();
    if (!id) return 'nexos_adaptive_guest_v1';
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'nexos_adaptive_user_' + (h >>> 0).toString(36);
  }

  function readDevicePrefs(userIdentity) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(devicePrefsKey(userIdentity));
      return raw ? sanitizePrefs(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }

  function writeDevicePrefs(userIdentity, prefs) {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(devicePrefsKey(userIdentity), JSON.stringify(sanitizePrefs(prefs)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function queryCommandCenter(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const raw = String(o.query || '').trim();
    const q = raw.toLowerCase();
    const st = o.state && typeof o.state === 'object' ? o.state : {};
    const actions = Array.isArray(o.actions) ? o.actions : [];
    const studyDocs = Array.isArray(o.studyDocs) ? o.studyDocs : [];
    const isGuest = Boolean(o.isGuest);

    const scoreText = (text) => {
      if (!q) return 10;
      const t = String(text || '').toLowerCase();
      if (!t) return 0;
      if (t === q) return 120;
      if (t.startsWith(q)) return 95;
      if (t.includes(' ' + q) || t.includes('#' + q)) return 80;
      if (t.includes(q)) return 60;
      return 0;
    };

    const hits = [];

    for (const act of actions) {
      const keywords = [act.title, act.detail, act.category, act.keywords].filter(Boolean).join(' ');
      const s = scoreText(keywords);
      if (q ? s > 0 : act.featured !== false) {
        hits.push({
          id: act.id || act.title,
          icon: act.icon || '⚡',
          title: act.title,
          detail: act.detail || '',
          category: act.category || 'Action',
          score: q ? s + (act.category === 'Action' ? 12 : 4) : (act.featuredScore || 50),
          run: act.run,
        });
      }
    }

    const tasks = Array.isArray(st.tasks) ? st.tasks : [];
    const taskLimit = q ? 8 : 3;
    let taskMatches = 0;
    for (const t of tasks) {
      if (!t) continue;
      const tags = Array.isArray(t.tags) ? t.tags.map(x => '#' + x).join(' ') : '';
      const blob = `${t.title || ''} ${t.desc || ''} ${t.priority || ''} ${t.stage || t.col || ''} ${tags}`;
      const s = q ? scoreText(blob) : ((t.stage || t.col) !== 'done' ? 42 : 0);
      if (s > 0) {
        hits.push({
          id: 'task-' + t.id,
          icon: '▦',
          title: t.title || 'Untitled task',
          detail: `${t.stage || t.col || 'todo'} · ${t.priority || 'medium'} priority${t.due ? ' · Due ' + t.due : ''}`,
          category: 'Task',
          score: s + 8,
          run: () => o.onOpenTask && o.onOpenTask(t),
        });
        if (++taskMatches >= taskLimit) break;
      }
    }

    if (typeof o.onOpenCalendar === 'function') {
      let calCount = 0;
      for (const t of tasks) {
        if (!t || t.scheduledHour === null || t.scheduledHour === undefined || t.scheduledHour === '') continue;
        const hNum = Number(t.scheduledHour);
        if (!Number.isInteger(hNum) || hNum < 0 || hNum > 23) continue;
        const hr = `${String(hNum).padStart(2, '0')}:00`;
        const s = q ? scoreText(`${t.title || ''} calendar schedule ${hr}`) : 35;
        if (s > 0) {
          hits.push({
            id: 'cal-' + t.id,
            icon: '📅',
            title: `${hr} · ${t.title || 'Scheduled block'}`,
            detail: 'Scheduled in Timeblocking Calendar',
            category: 'Calendar',
            score: s + 5,
            run: () => o.onOpenCalendar(t),
          });
          if (++calCount >= (q ? 5 : 2)) break;
        }
      }
      if (!calCount && st.dailyPlan && Array.isArray(st.dailyPlan.items)) {
        for (const item of st.dailyPlan.items) {
          if (!item || item.unscheduled || !item.start) continue;
          const s = q ? scoreText(`calendar plan ${item.start} ${item.title || ''}`) : 30;
          if (s > 0) {
            hits.push({
              id: 'plan-' + item.id,
              icon: '📅',
              title: `${item.start} · Day Plan Block`,
              detail: `${item.duration || 25} min (${item.type || 'task'})`,
              category: 'Calendar',
              score: s + 4,
              run: () => o.onOpenCalendar(item),
            });
            if (++calCount >= (q ? 4 : 2)) break;
          }
        }
      }
    }

    const notes = Array.isArray(st.notes) ? st.notes : [];
    const noteLimit = q ? 8 : 2;
    let noteCount = 0;
    for (const n of notes) {
      if (!n) continue;
      const tags = Array.isArray(n.tags) ? n.tags.join(' ') : '';
      const s = q ? scoreText(`${n.title || ''} ${n.content || ''} ${tags}`) : (n.pinned ? 36 : 25);
      if (s > 0) {
        hits.push({
          id: 'note-' + n.id,
          icon: '◧',
          title: n.title || 'Untitled note',
          detail: tags ? 'Tags: ' + tags : (n.content || '').replace(/\s+/g, ' ').slice(0, 68),
          category: 'Note',
          score: s + 6,
          run: () => o.onOpenNote && o.onOpenNote(n),
        });
        if (++noteCount >= noteLimit) break;
      }
    }

    const habits = Array.isArray(st.habits) ? st.habits : [];
    let habitCount = 0;
    for (const h of habits) {
      if (!h) continue;
      const s = q ? scoreText(`${h.name || ''} habit ${h.archived ? 'paused' : 'active'}`) : 0;
      if (s > 0) {
        hits.push({
          id: 'habit-' + h.id,
          icon: '◈',
          title: h.name || 'Habit',
          detail: h.archived ? 'Paused habit' : 'Habit Mastery tracker',
          category: 'Habit',
          score: s + 4,
          run: () => o.onOpenHabit && o.onOpenHabit(h),
        });
        if (++habitCount >= 6) break;
      }
    }

    if (!isGuest && studyDocs.length && typeof o.onOpenStudyDoc === 'function') {
      let docCount = 0;
      for (const d of studyDocs) {
        if (!d) continue;
        const s = q ? scoreText(`${d.title || ''} ${d.subject || ''} ${d.sourceType || ''} study material`) : 0;
        if (s > 0) {
          hits.push({
            id: 'study-' + d.id,
            icon: '📚',
            title: d.title || 'Study document',
            detail: `${d.subject || 'Study Library'} · ${d.chunkCount || 0} sections`,
            category: 'Study Material',
            score: s + 7,
            run: () => o.onOpenStudyDoc(d),
          });
          if (++docCount >= 6) break;
        }
      }
    }

    hits.sort((a, b) => b.score - a.score);
    const maxItems = q ? 14 : 10;
    return hits.slice(0, maxItems);
  }

  root.NexAdaptive = {
    SCHEMA_VERSION,
    VIEW_IDS,
    WIDGET_IDS,
    WIDGET_SIZES,
    DENSITIES,
    TEXT_SCALES,
    ACCENT_PRESETS,
    PRESETS,
    canonicalViewId,
    toClassicViewId,
    buildDefaults,
    sanitizePrefs,
    applyPreset,
    restoreDefaults,
    moveWidget,
    reorderWidgetTo,
    toggleWidgetHidden,
    setWidgetSize,
    resetDashboardLayout,
    togglePin,
    toggleNavHidden,
    moveNav,
    toggleGroup,
    setMobilePrimary,
    recordVisit,
    resetNavigation,
    applyDocumentTokens,
    devicePrefsKey,
    readDevicePrefs,
    writeDevicePrefs,
    queryCommandCenter,
  };
})(typeof window !== 'undefined' ? window : globalThis);
