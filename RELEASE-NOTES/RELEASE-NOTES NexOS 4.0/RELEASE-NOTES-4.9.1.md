# NexOS 4.9.1 — Navigation, Branding, Bug-Fix & Reliability Milestone

**Release version:** 4.9.1
**Source baseline:** Intermediate refinement milestone between `4.9.0` (`bd9f68f`) and `4.9.2` (`4ba0ffe` + Project Zero-Defect stability repairs). *Historical note: `4.9.1` was not separately tagged or deployed on its own; `package.json` stayed at `4.8.0` until unified `4.9.2` release packaging.*

This maintenance milestone refined sidebar interactions, Settings usability, NexOS visual branding, documentation screenshots, and cross-shell reliability prior to `4.9.2`.

## 1. Enterprise Navigation & Settings Control Center Refinements (`4ba0ffe`)
- **Uniform Sidebar Iconography & Compact Rail Interaction:** Replaced emoji/symbol variance in Enterprise navigation buttons with crisp inline SVGs, fixed Alerts and Export footer icon geometry, added floating tooltips outside the compact sidebar rail (`#ent-rail-tooltip`), enabled arrow-key sidebar navigation, and deduplicated Recent view links against active and pinned items.
- **Settings Usability & Search Jump Pills:** Refined the Enterprise Settings modal layout with a search clear button, category counts, clickable jump-to-setting hits, and category tags, alongside matching search clear (`#classic-settings-search-clear`) and jump-hit flash highlights in Classic Settings (`#profile-modal`).

## 2. Branding, PWA Icons & Documentation Refresh (`4ba0ffe`)
- **Unified Brand Asset Suite (`public/`):** Updated vector `favicon.svg` and manifest icon definitions (`public/manifest.json`), added `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, updated `nexos-icon-192.png` / `nexos-icon-512.png`, added maskable `nexos-icon-maskable-512.png`, and added matching icon precaching and HTML `<link>` declarations across `index.html`, `index-redesign.html`, `contact.html`, `privacy.html`, and `recover.html`.
- **Documentation & Screenshots (`README.md`, `docs/screenshots/`):** Refreshed README screenshots across Classic Soft/Glass views, Enterprise themes, collapsed compact rail, Settings Control Centers, Study Studio, NexAI, mobile sheets, and Recovery Center.
- **CSP Style Compliance (`server.js`):** Updated Helmet CSP `imgSrc` / static handling to support refreshed SVG and image branding assets cleanly.

## 3. Classic & Enterprise Reliability Repairs (`scripts/test-zero-defect-490.js`)
- **Classic Sidebar Collapse & Tooltip Repairs (`public/app.js`, `public/style.css`):** Fixed Classic compact sidebar widths across Soft (`76px`) and Glass (`64px` rail / `88px` content margin) designs, fixed compact hover tooltip cleanup and aria labels, aligned toast shelf margins with collapsed rails, enforced clean drawer transitions at the `900px` breakpoint (closing mobile drawers when opening Study Studio), and fixed keyboard arrow movement across visible sidebar items.
- **Navigation, Settings & Cross-Shell State Fixes:** Enforced the 6-destination pin cap in Classic & Enterprise navigation settings with disabled-state tooltips, prevented empty-state banners from masking the Guest push guidance card in Classic Notifications Settings, ensured Settings modals stack above toasts, repaired Enterprise `Reset all` theme restoration (`cyber-aubergine`), and padded Classic mobile bottom-bar slots when `calendar` is synced from shared preferences.
- **Data Integrity & Async Race Fixes (`public/app.js`, `public/index-redesign.html`, `public/recover.html`):** Preserved out-of-window Calendar time slots (`06:00`, `23:00`), ensured Classic Pomodoro midnight rollovers reset stale daily counters, prevented superseded concurrent Classic `summarizeNote()` requests from overwriting newer notes, and hardened Recovery backup validation against malformed `exportedAt` dates (`Invalid Date`) and negative focus stats.

## 4. Verification
- Verified via `scripts/test-signature-490.js` (brand icons, SW precache, HTML links, README screenshots, sidebar & Settings CDP checks) and `scripts/test-zero-defect-490.js` (Classic sidebar collapse/expand, breakpoint handoffs, pinning cap, note race protection, calendar slots, and Recovery sanitization).
