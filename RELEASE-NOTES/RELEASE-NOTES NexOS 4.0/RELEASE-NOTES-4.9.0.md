# NexOS 4.9.0 — Project Adaptive Personalization, Command Center & Settings Release

**Release version:** 4.9.0
**Source commit:** `bd9f68f` (`2026-11-28`, Project Adaptive; `package.json` package metadata stayed at `4.8.0` until `4.9.2` consolidation)

NexOS 4.9.0 introduced workspace personalization, Workspace Profiles, customizable dashboards and sidebars, the upgraded `Ctrl+K` Command Center, categorized Settings Control Centers, and distraction-free Focus Mode across both **Classic** (`/`, `/classic`) and **Enterprise** (`/enterprise`).

## 1. Adaptive Workspace Personalization Engine (`public/adaptive.js`)
- **Unified Schema & Sanitizers (`NexAdaptive`, `SCHEMA_VERSION = 1`):** Added `buildDefaults()`, `sanitizePrefs()`, `applyPreset()`, `restoreDefaults()`, and token application (`applyDocumentTokens()`) shared by Classic and Enterprise.
- **Guest & Account Persistence (`devicePrefsKey`, `readDevicePrefs`, `writeDevicePrefs`):** Saved per-user (or guest) preferences in device `localStorage` and synchronized them via `/api/bootstrap` and `PUT /api/state` using newer-timestamp reconciliation without disrupting tasks, habits, or notes.

## 2. Four Workspace Presets & Dashboard Customization
- **Four Coordinated Workspace Profiles (`PRESETS`):**
  - `Balanced Workspace`: standard 4-widget layout, expanded sidebar, `25`/`5`/`15` min sprint durations.
  - `Deep Work Workspace`: Focus & Tasks first (`pomodoro`, `tasks`, `notes`), Habits widget hidden by default, compact sidebar, `50`/`10`/`20` min sprints, strong focus highlights.
  - `Study Workspace`: surfaces Focus, Smart Notes (`wide`), Tasks, and Habits (`50`/`10`/`20` min sprints), pinning Study Studio, Deep Focus, and Smart Notes.
  - `Minimal Workspace`: spacious reduced-chrome layout centered on Kanban Tasks and Smart Notes with Focus and Habits hidden and compact rail navigation.
- **Dashboard Widget Controls:** Added `moveWidget()`, `reorderWidgetTo()`, `toggleWidgetHidden()`, `setWidgetSize()` (`compact`, `normal`, `wide`), and `resetDashboardLayout()`, paired with inline customize toolbars and drag-and-drop reordering in Classic and Enterprise.

## 3. Sidebar & Navigation Personalization
- **Layout & Links:** Added compact icon-rail vs expanded sidebar switching (`sidebarMode`), custom pinned destinations (`togglePin()`, up to 6 views), show/hide toggles (`toggleNavHidden()`, protecting `dashboard`), custom view ordering (`moveNav()`), collapsible groups (`toggleGroup()`), recent-visit tracking (`recordVisit()`), and configurable 4-slot mobile bottom navigation primary tabs (`setMobilePrimary()`).

## 4. Global Command Center (`Ctrl+K` / `Cmd+K`)
- **Cross-Workspace Command & Record Search (`queryCommandCenter()`):** Ranked search across Quick Actions (create task, note, habit, timer, presets, themes, Focus Mode, Settings/experience jumps), Tasks (titles, stages, priorities, `#tags`), Timeblocking Calendar scheduled hours (`scheduledHour`) and Day Plan items, Notes (titles, content, tags), Habits (active & paused), and Study Studio indexed documents (for authenticated sessions).

## 5. Eight-Category Settings Control Center & Accessibility
- **Categorized Settings Architecture (`#profile-modal`, `#modal-enterprise-settings`):** Organized settings under `All` plus eight categories—`General`, `Appearance`, `Workspace`, `Navigation`, `Accessibility`, `Notifications`, `Shortcuts` / `Keyboard Shortcuts`, and `Data & Privacy`—with instant keyword search filtering, live appearance preview, and restore-defaults controls.
- **Theme, Accent, Density & Accessibility Controls:** Added `accentPreset` (`theme`, `cobalt`, `emerald`, `violet`, `amber`), `interfaceDensity` (`compact`, `comfortable`, `spacious`), typography `textScale` (`90%`–`120%`), `reducedMotion`, `highContrast`, strong keyboard `focusHighlight`, and `minimalChrome`, applied pre-paint in both shells to avoid visual flash.

## 6. Focus Mode HUD (`Alt+F`)
- **Distraction-Free Workflow (`#classic-focus-hud`, `toggleClassicFocusMode`, `toggleZenMode`):** Hides sidebar chrome on demand (`Alt+F`) or automatically on Pomodoro timer start (`autoZenOnStart`), displaying live countdown, start/pause controls, quick module switches, and one-click Focus Mode exit.

## 7. Server-Side Validation & Ownership Isolation (`server.js`)
- **Backend Hardening (`sanitizeServerAdaptivePrefs()`):** Strictly validated incoming `adaptivePrefs` trees inside `sanitizeWorkspaceState()`, enforcing value allowlists, finite numeric bounds, clamped view/widget/pin arrays, and per-user ownership isolation through `requireAuth` on `/api/bootstrap` and `PUT /api/state`.

## 8. Service Worker & Verification
- Updated `public/sw.js` to precache `/adaptive.js` alongside Classic app-shell assets while preserving `/api/` network bypass.
- Added `scripts/test-adaptive-490.js` covering unit checks, backend schema sanitization & ownership isolation, and multi-journey / 9-viewport browser verification.
