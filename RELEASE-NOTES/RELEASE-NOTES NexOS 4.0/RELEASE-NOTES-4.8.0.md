# NexOS 4.8.0 — Pre-Release Hardening, Data Integrity & Accessibility Release

**Release version:** 4.8.0
**Release date:** 2026-11-28

## 1. Reliability and Backend Security
- **Workspace state sanitization (`server.js`):** Added `sanitizeWorkspaceState()` with recursion depth enforcement (`MAX_STATE_DEPTH = 24`), recursive stripping of `__proto__`, `constructor`, and `prototype` keys, rejection of MongoDB `$` operator keys with HTTP `400` (`BAD_STATE`), and normalization of non-finite numbers to `null` before writing `PUT /api/state`.
- **Strict ObjectId validation (`server.js`, `lib/study-planner.js`):** Added `isValidHexId()` (`^[0-9a-fA-F]{24}$` paired with `mongoose.isValidObjectId`) on `/api/chat`, `GET /api/chats/:id`, and `DELETE /api/chats/:id`, and updated `GET /api/study/calendar/callback` to validate decoded JWT user IDs with `isValidId()` and guard missing `JWT_SECRET` (`500`) and `getToken()` errors (`400`).
- **Cookie-clearing alignment (`server.js`):** Centralized `clearTokenCookie(req, res)` using `{ httpOnly: true, secure: isProd || req.secure, sameSite: 'lax' }` across `requireAuth` invalidation, `POST /api/auth/logout`, and `DELETE /api/me`.
- **Input, push subscription & upstream hardening (`server.js`, `lib/study-planner.js`):** Rejected whitespace-only prompts in `POST /api/complete` (`400`), enforced push endpoint URL length limits (`<= 2048`) and reset `sentKeys: []` on `POST /api/push/subscribe`, cancelled unread retryable upstream streams in `askGeminiStream()`, added `AbortSignal.timeout` (`8000` ms / `5000` ms) to Google Calendar API requests, and isolated plan deletion when an external OAuth token was revoked.

## 2. Data Integrity and Recovery
- **Recovery Center optimistic concurrency retry (`public/recover.html`):** Added `apiRaw()` and `expectedRev` revision tracking inside `addBack()`, retrying up to 3 attempts on `409` conflicts by re-merging the restored item into the server conflict `state`.
- **Recovery backup validation (`public/recover.html`):** Updated `NexRecover.validateAndSanitizeBackup` to preserve valid `scheduledHour` (`0`–`23`) values, strip invalid hours, normalize Enterprise `stage` to Classic `col`, and preserve note `updated` timestamps.
- **Classic backup import hardening (`public/app.js`):** Enforced a `5 MB` upload size limit and stripped `__proto__`, `constructor`, and `prototype` recursively via `sanitizeImportedObject()` inside `importData()`, keeping existing state untouched when malformed files are rejected.
- **Storage quota protection (`public/app.js`, `public/index-redesign.html`):** Wrapped workspace and cache `localStorage` writes in `safeLocalSet()` and `safeEnterpriseStorageSet()` so `QuotaExceededError` triggers rate-limited toast feedback rather than throwing uncaught runtime exceptions.

## 3. NexAI and AI Response Reliability
- **Empty upstream `STOP` fallback (`lib/nexai-reliability.js`, `public/app.js`, `public/index-redesign.html`):** Ensured `askWithAutoContinuation()` returns a safe non-empty fallback when upstream completes with an empty response, and guarded Classic `readChatStream()` and Enterprise `postEnterpriseChat()` with safe fallback reply text (`"I couldn't produce an answer for that."`).
- **Workspace context parity (`public/index-redesign.html`):** Updated `enterpriseWorkspaceContext()` to report `getEffectivePomodoroTotals()` so NexAI sees log-reconciled focus minutes and sessions.

## 4. Study Studio and Learning Workflow
- **Keyboard upload trigger & flashcard check-in parity (`public/study.js`):** Enabled `Enter` and `Space` activation on the `#ns-drop` upload zone when idle, and ensured completing the final flashcard via **Review again** (`[data-ns="card-again"]`) triggers `adapter.recordStudyCheckIn()`, matching `card-known`.
- **Date-boundary & ownership verification (`lib/study-planner.js`):** Verified leap-day (`computeNextDueAt`, `zonedDateKey`) and year-end (`addDaysToKey`) rollovers and cross-user isolation on `/api/study/reviews/:id/rate`.

## 5. Dashboard, Tasks and Focus Integration
- **Enterprise Pomodoro log reconciliation (`public/index-redesign.html`):** Added `getEffectivePomodoroTotals()` and aligned `updateKPICounters()`, `refreshDailyInsight()`, `finishPomodoroInterval()`, `renderPomTimerUI()`, `saveWeeklyReviewToNotes()`, `classicRootToEnterprise()`, and `adoptMergedIntoState()` so focus minutes and sessions reconcile consistently with `pomodoroLog` and `#ctx-focus-badge` reflects today's focus minutes.
- **Task validation & suggestion sequencing (`public/app.js`, `public/index-redesign.html`):** Validated empty task titles (`aria-invalid="true"` via `setFieldInvalid()` / `setEnterpriseFieldInvalid()`), capped titles at 160 characters on creation and modal save, and added `classicAiSuggestSeq` + `editingTaskId` guards to Classic `aiSuggestTask()`.
- **Kanban filtered empty state (`public/index.html`, `public/app.js`, `public/index-redesign.html`, `public/style.css`):** Added `#classic-kanban-filter-empty` (`clearClassicKanbanFilters()`) and `#ent-kanban-filter-empty` (`resetEnterpriseKanbanFilters()`) banners to recover cleanly when search or priority filters match zero tasks.

## 6. Calendar and Timeblocking
- **Calendar quick Focus & action clarity (`public/index-redesign.html`):** Simplified the Enterprise Calendar primary CTA label to `📅 Plan Day` and added quick `▶` focus launch buttons (`focusOnTask()`) to non-done `.calendar-event-pill` items.
- **Responsive slot & pill geometry (`public/index-redesign.html`):** Updated `.calendar-hour-row` (`flex: 0 0 auto; grid-template-columns: 80px minmax(0, 1fr)` on desktop; `52px minmax(0, 1fr)` on mobile) and enabled flex wrapping + `overflow-wrap: anywhere` inside `.calendar-event-pill` so scheduled rows never overlap vertically or overflow horizontally.

## 7. Smart Notes and Analytics
- **Concurrent AI summarize race guard (`public/app.js`, `public/index-redesign.html`):** Added sequence counters (`classicNoteSummarizeSeq` and `enterpriseNoteSummarizeSeq`) so stale out-of-order `/api/complete` responses cannot overwrite newer requests, and preserved live edits typed while Classic `summarizeNote()` is in flight.
- **Top-note auto-selection (`public/index-redesign.html`):** Automatically selects the first available note in `renderNotesList()` when `state.currentNoteId` is unset or missing (unless edits are dirty).
- **Offline Analytics geometry (`public/app.js`, `public/style.css`):** Applied `.chart-wrap.is-offline` (`height: auto !important`), hid offline `<canvas>` elements (`display: none`), included overdue counts in Classic `taskDonut` summaries, and restored canvases when `Chart.js` loads.

## 8. Accessibility and Responsive Design
- **Dialog focus trapping & scroll-lock cleanup (`public/index-redesign.html`, `public/app.js`, `public/ui.js`):** Added `role="dialog"`, `aria-modal="true"`, accessible headings/close labels, `Tab`/`Shift+Tab` focus wrapping, opener tracking (`enterpriseModalOpeners`) with focus restoration and scroll unlock on `closeModal()` / `Escape` in Enterprise, plus `NexUI.observeModal()` in Classic for dynamic `#nexos-action-modal` dialogs.
- **Global `[hidden]` & mobile touch targets (`public/index-redesign.html`, `public/design.css`, `public/style.css`):** Added `[hidden] { display: none !important; }` in Enterprise, `:not([hidden])` responsive guards so hidden buttons remain hidden, normalized mobile touch targets (`>= 32px`–`38px`), centered `.task-check.checked::after` ticks, fitted Enterprise Notes and NexAI panes above the desktop fold (`calc(100dvh - 216px)`), made `.editor-format-strip` horizontally scrollable on narrow viewports, and marked invalid empty Habit inputs with `aria-invalid="true"`.

## 9. Performance Improvements
- **CSS layout containment (`public/style.css`, `public/index-redesign.html`):** Added `contain: layout style` on Kanban `.task-card` and Notes list cards.
- **Cached legacy redirect parsing (`server.js`):** Cached `LEGACY_REDIRECTS_JSON` parsing across requests when the env string is unchanged.
- **Asset versioning & Service Worker cache bump:** Aligned `package.json`, `package-lock.json`, `docker-compose.yml` (`com.nexos.version=4.8.0`), HTML `?v=4.8.0` asset references (`index.html`, `index-redesign.html`, `contact.html`, `privacy.html`), and `public/sw.js` (`CACHE = 'nexos-shell-v41'`), preserving activation cleanup of older `nexos-shell-*` caches and network pass-through for `/api/*`.

## 10. Testing and Verification
- **`scripts/test-product-v480.js`:** Runtime Node/VM and Chrome DevTools Protocol (CDP) verification of `NexRecover.validateAndSanitizeBackup`, Recovery `409` conflict retry (`expectedRev`), Classic offline Analytics card bounds, Study Studio `#ns-drop` keyboard open and `card-again` check-in, Enterprise focus reconciliation, concurrent out-of-order `aiSummarizeActiveNote` race handling, Calendar-to-Focus jump, Kanban filter empty banners, tablet/mobile viewports, and all 5 Enterprise themes.
- **`scripts/test-fortress-480.js`:** End-to-end backend and Chrome CDP fortress suite validating `/api/state` prototype-pollution stripping, `$` operator rejection, nesting-depth limits, non-24-hex ObjectId rejection, whitespace `/api/complete` rejection, study-planner leap-day/year-end rollover & cross-user isolation, `QuotaExceededError` handling, backup corruption rejection, modal focus traps, Classic light/dark `>= 4.5:1` contrast, zero unlabeled visible buttons, 250-task Kanban scale performance and zero DOM-leak navigation, and 7 viewports (`1920×1080` through `320×700`).
- **Full suite & release alignment:** All `15` `node --check` checks and `46` automated test scripts in `package.json`, `git diff --check`, release-note filename/link checks, and version/Service Worker consistency checks verified against the `4.8.0` release candidate.

## 11. Known Limitations
- All automated server, persistence, AI, Calendar OAuth, and browser suites executed locally using in-memory model stubs, local HTTP fixtures, and mocked `409`/SSE responses rather than live external credentials.
- Live MongoDB Atlas persistence, live Google OAuth sign-in, live Google Gemini API streaming/completions, live Google Calendar OAuth synchronization, and live VAPID Web Push delivery were **not** exercised against external production services in this environment and require staging/production verification with configured environment secrets.
- `npm run lint` (`eslint server.js`) is not configured with an ESLint config file in the repository; JavaScript syntax checks across backend and client modules run via `node --check`.
