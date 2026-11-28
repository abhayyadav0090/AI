# NexOS 4.6.0 — Full-Viewport Study Studio, Scroll Isolation & Reliability Release

**Release version:** 4.6.0
**Release date:** 2026-11-28

## Highlights
- **Full-viewport Study Studio in Classic and Enterprise:** Replaced the centered modal/bottom-sheet popup presentation in `public/study.js` with an edge-to-edge full-viewport workspace (`100vw` × `100dvh`) across Desktop, Tablet, and Mobile layouts, while keeping all six Study Studio tabs (`Tutor`, `Quiz`, `Cards`, `Mindmap`, `Revision`, `Library`), guest previews (`Tutor sample` and `Mindmap preview`), solid theme-aware surfaces across Soft and Glass/Enterprise themes, and responsive Mindmap canvas sizing (`clamp(320px, 50dvh, 540px)` desktop; `290px` mobile).
- **Complete background scroll lock & boundary scroll-chaining isolation:** Fixed foreground scrolling from chaining onto the background document at top/bottom scroll boundaries across mouse wheel, trackpad, and touch input while keeping internal panels, nested scrollable areas, horizontal starter pills, and Mindmap zoom/pan responsive and restoring exact background scroll offsets and document inline styles on exit.
- **Navigation, history & focus lifecycle integration:** Added a visible `← Back` control alongside Close, exported `NexStudy.close()` integrated with `switchView` (Classic) and `switchNexusView` (Enterprise), managed `pushState`/`popstate` history with `history.scrollRestoration = 'manual'` and pending-back tracking so browser Back closes Study Studio cleanly without losing background scroll position or underflowing history under rapid toggling, added `Tab`/`Shift+Tab` focus trapping, made `Escape` cancel open Mindmap node edits before closing Study Studio, and guarded async callbacks/timers with `openSeq`.
- **NexAI reliability preserved:** Verified that Render cold-start offline/cached bootstrap fallback (`checkLogin`/`retrySync`), server-side `MAX_TOKENS` auto-continuation and overlap deduplication (`lib/nexai-reliability.js`), and automatic client **Continue** UI with premature-action suppression (`public/chat-tasks.js`, Classic, and Enterprise) remain intact.

## Fixes & Hardening
- **CORS `PATCH` support (`server.js`):** Added `'PATCH'` to CORS `methods` alongside `GET`, `POST`, `PUT`, and `DELETE` so Study Exam Plan topic check-off requests (`PATCH /api/study/plans/:id/topics/:index`) succeed across allowed origins.
- **Classic toast stacking (`public/design.css`):** Raised `html[data-design] .toasts` `z-index` from `2000` to `2500` so Classic notifications remain visible above full-page Study Studio (`2100`), matching Enterprise `.toast-shelf`.
- **Note summarization race fixes (`public/app.js`, `public/index-redesign.html`):** Guarded Classic `summarizeNote()` and Enterprise `aiSummarizeActiveNote()` by target note ID so switching notes while `/api/complete` is in flight writes the summary back to the originating note instead of overwriting the newly opened note or leaving the editor disabled.
- **Background keyboard shortcut guard (`public/app.js`, `public/index-redesign.html`):** Ignored `Ctrl+K`, `?`, `Ctrl+\`, and `Ctrl+S` when `#nexos-study-modal[data-open="1"]` or `#nexos-derail-modal[data-open="1"]` is active so background palettes/dialogs cannot open behind full-screen overlays.
- **Day Derailed scroll lock & keyboard accessibility (`public/derail.js`):** Added `lockDerailScroll()`/`unlockDerailScroll()` document scroll locking, `overscroll-behavior: contain` on `.nd-body`, `Tab` focus trapping, and focus restoration on close.
- **Observer & timezone consistency (`public/app.js`, `public/index-redesign.html`, `public/study.js`):** Coordinated Classic and Enterprise modal scroll observers with `externalLock` so they do not overwrite Study Studio or Day Derailed body offsets during mobile/tablet sidebar transitions, and standardized `createPlan()` on `localTimeZone()`.
- **Asset & PWA cache busting:** Updated `package.json`, `package-lock.json`, `docker-compose.yml` label (`com.nexos.version=4.6.0`), HTML `?v=4.6.0` asset queries, and Service Worker `CACHE = 'nexos-shell-v39'`.

## Tests & Verification
- Added **`scripts/test-study-fullpage-460.js`** running real headless Chrome DevTools Protocol (CDP) and HTTP checks across Classic (`/`) and Enterprise (`/enterprise`) at Desktop (`1280x800`), Tablet (`768x1024`), and Mobile (`360x740`), verifying full-viewport geometry, Apple Glass background opacity, wheel/touch boundary isolation, nested scrolling, Mindmap zoom/CRUD flow, `popstate`/Back and view-switching lifecycle, note-summarization race protection, NexAI `STOP`/`MAX_TOKENS` Continue flow, CORS `PATCH` preflight, standalone pages (`contact.html`, `privacy.html`, `recover.html`), and release metadata consistency.
- Executed **`npm test`** (`15` `node --check` syntax checks + `43` Node and Chrome CDP test scripts) and **`git diff --check`**: all passed (`exit code 0`).

## Known Verification Limitations
- All automated server, database, AI, and browser tests ran locally using in-memory/mocked HTTP or local SSE handlers rather than live cloud credentials.
- Live MongoDB Atlas persistence, live Google OAuth sign-in, live Google Gemini API responses, live Google Calendar OAuth synchronization, and live VAPID Web Push delivery were **not** executed against live external services in this environment.
- `npm run lint` (`eslint server.js`) exits non-zero under ESLint 8.57.1 because the repository does not include an ESLint configuration file; JavaScript syntax across backend and frontend modules is checked via `node --check`.
