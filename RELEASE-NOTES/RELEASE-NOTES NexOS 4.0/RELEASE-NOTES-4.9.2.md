# NexOS 4.9.2 — Personal Workspace, Two-Group Navigation, Smart Onboarding & Signature Release

**Release version:** 4.9.2
**Release date:** 2026-11-28

NexOS 4.9.2 consolidates the completed **Project Adaptive**, **Project Signature**, **Project Zero-Defect**, and **Project Welcome & Navigation Refinement** engineering milestones into a verified production release across Classic (`/`, `/classic`) and Enterprise (`/enterprise`) shells.

## 1. Enterprise Navigation and Sidebar
- **Two-group inline container architecture (`public/index-redesign.html`, `public/adaptive.js`):** Replaced the flat 3-group sidebar list with two semantic `<section class="ent-nav-group">` parent-child containers—**Workspace** (`Dashboard`, `Kanban Board`) and **Productivity** (`Deep Focus`, `Habit Mastery`, `Smart Notes`, `Analytics`, `Timeblocking`, `Study Studio`, `NexAI`)—so expanded items always stay visually underneath their own section header regardless of custom view order or selected preset.
- **Sequential shortcut alignment:** Preserved sequential top-to-bottom `Alt+1` through `Alt+9` navigation bindings and labels (`Alt+8` opens Study Studio) alongside compact icon-rail tooltips, recent views deduplication, pinned shortcuts, and mobile drawer accessibility (`syncDrawerA11y`).
- **Legacy group preference migration (`public/adaptive.js`, `server.js`):** Added `normalizeGroupId()` and `migrateCollapsedGroups()` to map legacy `'growth'` group states to `'productivity'`, ignore obsolete `'knowledge'` or unknown group IDs, and enforce strict server-side normalization on `PUT /api/state`.

## 2. Workspace Personalization
- **Shared Adaptive Engine (`public/adaptive.js`):** Added sanitized `adaptivePrefs` (`SCHEMA_VERSION = 1`) synced across `/api/bootstrap`, `PUT /api/state`, and device-scoped `localStorage`, driving dashboard widget order/size/visibility, custom navigation pinning (up to 6 views), compact sidebar rail mode, mobile bottom-bar primary tabs (4 slots), interface density (`compact`, `comfortable`, `spacious`), text scale (`90%`–`120%`), accent presets, reduced motion, high contrast, strong keyboard focus highlights, and minimal chrome.
- **Workspace Profiles & Focus Mode:** Added `Balanced Workspace`, `Study Workspace`, `Deep Work Workspace`, and `Minimal Workspace` presets that coordinate layout, navigation, and Pomodoro sprint durations without deleting user items, plus distraction-free **Focus Mode HUD** (`Alt+F` / auto-HUD preference) across Classic and Enterprise.
- **Global Command Center (`Ctrl+K` / `Cmd+K`):** Upgraded global search via `NexAdaptive.queryCommandCenter()` across tasks, habits, notes, Calendar scheduled hours, Study Studio indexed documents, quick creation actions, presets, themes, and navigation commands.

## 3. Settings Control Center
- **Enterprise & Classic Settings Control Center (`public/index-redesign.html`, `public/app.js`, `public/index.html`, `public/style.css`):** Organized settings into categorized sections (`General`, `Appearance`, `Workspace`, `Navigation`, `Accessibility`, `Notifications`, `Keyboard Shortcuts`, `Data & Privacy`) with live search filtering, category jumps, live preview panels, Appearance & Layout controls, and direct access to onboarding, tour replay, and discovery tip resets.
- **Standalone legal & recovery pages (`public/contact.html`, `public/privacy.html`, `public/recover.html`):** Aligned asset versions while preserving existing layouts, `contact.html` styling/background, and Recovery Center optimistic concurrency backup restoration.

## 4. Smart Onboarding and Guided Tour
- **Smart Onboarding module (`public/onboarding.js`):**
  - **Non-blocking Welcome Studio:** Automatically welcomes genuine first-run empty Guest (`nexos_guest_mode_v1`) and newly registered accounts with interactive live-preview preset selection, `Later`, `Skip` (reverting unsaved live previews cleanly), `Continue to Tour`, and `Finish`, while hiding duplicate legacy `#qs-card` prompts.
  - **Existing-user protection (`shouldOfferWelcome`):** Automatically skips onboarding prompts for accounts with existing tasks, habits, notes, `seeded` flag, saved goals, or prior customization, while allowing manual replay from Settings.
  - **6-step Guided Product Tour:** Highlights real UI targets across Dashboard, Two-Group Sidebar, `Ctrl+K` Command Center, Kanban & Timeblocking, Focus & Study Studio, and Settings, with `Previous`, `Next`, `Finish`, `Skip`, `Escape`, `ArrowLeft`/`ArrowRight` navigation, responsive mobile drawer handling, reduced-motion support, and visible focus restoration.
  - **Contextual Feature Discovery Hints:** Single non-blocking tip pill (`pin-nav`, `sidebar-compact`, `dash-customize`, `cmd-center`, `settings-search`, `focus-mode`) with dismiss and persistent opt-out (`Never show tips`), preserved across visual preference resets.

## 5. NexOS Branding and PWA Icons
- **Unified Vector & Icon Suite (`public/`):** Shipped consistent vector and raster NexOS brand icons across HTML pages, Service Worker precache, and `public/manifest.json`: `favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `nexos-icon-192.png`, `nexos-icon-512.png`, and `nexos-icon-maskable-512.png`.

## 6. Documentation and Screenshots
- **Refreshed Documentation (`README.md`, `docs/screenshots/`):** Updated `README.md` with current 4.9.2 highlights, release history, and 24+ freshly captured sample-data screenshots spanning Classic Soft/Glass designs, Enterprise themes, collapsed compact sidebar rail, Settings Control Center, Study Studio, NexAI, Mobile layouts, and Recovery Center.

## 7. Bug Fixes and Reliability
- **Classic sidebar collapse/expand repair (`public/app.js`, `public/style.css`):** Fixed Classic compact sidebar toggle state, tooltip positioning, mobile drawer layout interactions, and keyboard navigation.
- **Enterprise empty-workspace starter seeding fix (`public/index-redesign.html`):** Fixed `seedEmptyWorkspace()` and `enterpriseQuickStart()` so locally seeded `qs-*` starter tasks are no longer wiped during `buildMergedRoot()` before their initial server save (`dropStaleStarterItems` now triggers only when a remote snapshot already carries `seeded: true`).
- **Classic boot initialization timing (`public/app.js`):** Moved `initClassicOnboarding()` and quick-start initialization ahead of async push-preference network requests so Settings onboarding and tour triggers are ready immediately on workspace mount.
- **Settings & modal synchronization (`public/index-redesign.html`, `public/onboarding.js`):** Triggered contextual `navigation` tab hints reliably on modal open, kept DOM focus on the active preset card during live previews, and ensured mobile Welcome action alignment and tour overlay stacking above transient toasts.

## 8. Responsive Design and Accessibility
- Verified zero horizontal overflow (`scrollWidth <= innerWidth + 1`) across 9 desktop, tablet, and mobile viewports (`1920x1080` through `320x700`).
- Verified keyboard accessibility across sidebar arrow navigation, modal `Tab`/`Shift+Tab` focus traps, tour `Escape`/`ArrowLeft`/`ArrowRight` bindings, opener focus restoration, high-contrast tokens, `apple-light` theme legibility, and `prefers-reduced-motion` support.

## 9. Performance and Testing
- **Version alignment & Service Worker cache (`public/sw.js`):** Updated `package.json`, `package-lock.json`, `docker-compose.yml` (`com.nexos.version=4.9.2`), HTML asset URLs (`?v=4.9.2`), and Service Worker cache namespace (`CACHE = 'nexos-shell-v42'`, precaching `/onboarding.js?v=4.9.2`) while retaining cleanup of prior `nexos-shell-*` caches and strict `/api/` network pass-through.
- **Expanded verification suites:** Added and verified `scripts/test-adaptive-490.js`, `scripts/test-signature-490.js`, `scripts/test-zero-defect-490.js`, and `scripts/test-welcome-nav-490.js` alongside all full-suite syntax checks and historical regression suites in `npm test`.

## 10. Known Limitations
- Automated backend, API persistence, AI chat, Study Studio, and headless Chrome CDP suites ran locally against stubbed Mongoose models and local HTTP fixtures rather than live external production infrastructure.
- Live MongoDB Atlas connectivity, live Google OAuth sign-in, live Google Gemini API responses, live Google Calendar OAuth synchronization, and live VAPID Web Push delivery were not exercised against external cloud credentials in this local verification environment and require live staging checks with configured secrets.
- `npm run lint` (`eslint server.js`) has no standalone ESLint configuration file in the repository; module syntax verification runs through `node --check` across backend and client scripts in `npm test`.
