# NexOS: AI Productivity Workspace

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white) ![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white) ![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-22d3ee?style=flat-square)

NexOS is a web workspace for planning your day and staying focused. It combines a Kanban board, focus timer, habit tracker, notes and analytics with **NexAI**, an assistant powered by Google Gemini that can work with your tasks, habits, focus activity and notes.

**Current source release: 3.3.1.** The 3.x series focuses on performance, mobile usability, reliable navigation and a more capable NexAI experience while preserving existing NexOS features and workspace data.

**Live demo:** [https://ai-aqit.onrender.com](https://ai-aqit.onrender.com)

The demo runs on a free server, so its first load after inactivity can take up to a minute.

NexOS is developed independently, with AI used as a pair-programming tool.

![Dashboard](docs/screenshots/dashboard.png)

| Kanban | NexAI | Mobile |
|:---:|:---:|:---:|
| ![Kanban](docs/screenshots/kanban.png) | ![NexAI](docs/screenshots/nexai.png) | ![Mobile](docs/screenshots/mobile.png) |

---

## Features

### Tasks

- Kanban board with four stages: To Do, In Progress, Review and Done.
- Drag and drop on desktop; arrow controls on phones.
- Priority levels, due dates and descriptions.
- AI helper for suggesting task descriptions.
- **Plan My Day:** build a schedule from open tasks and habits, either by priority and due date or with AI.

### Focus

- Pomodoro timer with focus, short-break and long-break modes.
- Adjustable durations, optional automatic break start and sound.
- Daily focus minutes are logged and shown in analytics.

### Habits

- Daily check-ins on a 7-day grid with streak counters.
- 12-week completion heatmap.

### Notes

- Tags, pinning, search, filters and word count.
- One-click AI summary of a note.

### Analytics

- Focus time over 7, 14 or 30 days, task status split, habit completion and daily productivity score.
- Tasks completed per day and a weekly review comparing this week with last week.
- Save the weekly review as a note.

### NexAI (Google Gemini)

- Chat with saved history: open, continue and delete past conversations.
- Each message can use a current snapshot of workspace information, including tasks, habits, focus time and notes.
- Daily AI insight on the dashboard.
- **Action Mode:** describe a goal, review proposed actions (such as creating tasks, updating tasks or creating notes), and apply only the actions you approve.
- **Voice input (3.2.0):** dictate messages, Action Mode instructions and supported task fields in Classic and Enterprise. Where available, the microphone language can be switched between English (India) and Hindi. Dictation fills the input; it does not automatically submit the message or approve an action.
- **File analysis (3.3.0):** attach up to 3 supported files, with a combined limit of 6 MB, to a main NexAI chat in Classic or Enterprise. Supported types include PDF, PNG, JPG, WEBP and supported text/code files such as TXT, MD, CSV, PY, JS and JAVA. NexAI can describe images, summarise documents and help solve assignments step by step.
- On mobile, the attachment picker can offer camera and gallery options where the browser supports them.
- Uploaded files are validated by the server and are processed for the request rather than kept as permanent workspace files. If sending fails, the draft message and selected files remain available for retry.
- **3.3.1 mobile layout:** the NexAI mobile interface groups Action Mode, New Chat, Workspace Context and Past Conversations into compact controls. Context and history open in a sheet so the chat can use more of the available screen height. Desktop layout remains unchanged by this mobile-specific adjustment.
- **3.3.1 dictation reliability:** speech recognition results are rebuilt from the current recognition session instead of blindly appending every browser result. This prevents repeated words when a browser sends progressively longer recognition results and preserves multiple phrases returned in one event.

### General

- **Guest mode:** try the app without an account. Guest data stays in the browser and NexAI is disabled.
- Google sign-in, with workspace data saved per user in MongoDB. NexOS receives the Google profile information needed for the account, such as name, email and profile picture.
- **Profile panel:** change the display name, download workspace and NexAI data, or delete the account and its NexOS data. In guest mode, download or clear the guest data on that device.
- Global search for tasks and notes (`Ctrl+K`).
- JSON backup and restore.
- Browser notifications for tasks due today or overdue (while the app is open; push reminders may also be configured separately).
- Starter data and a Getting Started checklist for new users.
- Two designs: **Google** (Material 3) and **Apple** (liquid glass), each with light, dark or match-device themes.
- Responsive layouts with bottom navigation on phones.
- Keyboard shortcuts: `Alt+1` to `Alt+7` switch Classic views, `Ctrl+K` opens search and commands, `Ctrl+S` saves a note, `?` lists shortcuts and `Esc` closes dialogs. Enterprise also supports `Alt+1` to `Alt+8` for its views and `Ctrl+\` to toggle the NexAI panel.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML5 and CSS3; no frontend framework or build step |
| Charts | Chart.js 4 |
| Backend | Node.js 18+, Express 4 |
| Database | MongoDB Atlas with Mongoose |
| Authentication | Google Sign-In, with JWT in an httpOnly cookie |
| AI | Google Gemini API, called from the server |
| Security | Helmet (CSP), CORS allow-list and express-rate-limit |
| Hosting | Render |

---

## How it works

```text
Browser (HTML, CSS, JavaScript)
   |
   |  /api/auth, /api/bootstrap, /api/state, /api/chat, /api/chats, /api/complete
   v
Express server  --->  MongoDB Atlas (users, saved state, chats)
   |
   +--> Google Gemini API (the API key stays on the server)
```

- **State:** tasks, habits, notes and timer logs are saved as one JSON document per user and synchronised after changes. The browser keeps a local copy to help protect against network interruptions.
- **Startup:** Classic and Enterprise can use `/api/bootstrap` to load account information and workspace data together, reducing separate startup requests.
- **Chats:** NexAI conversations are saved in MongoDB. A message and its reply are saved only when the AI call succeeds.
- **AI reliability:** the server can retry temporary Gemini failures and switch to a configured fallback model. NexOS shows a clear message when the available quota is exhausted.
- **Limits:** AI requests are rate-limited per signed-in user (the configured defaults are 30 per minute and 500 per day).
- **File handling:** supported attachments are checked by the server, subject to the chat upload limits, and are not retained as permanent user files.
- **Safe rendering:** user and AI text is escaped before it is placed in the page.

For detailed technical information, see [ARCHITECTURE.md](mds/ARCHITECTURE.md).

---

## Run it locally

You need Node.js 18 or newer, a MongoDB Atlas database, a Google OAuth client ID and a Gemini API key.

```bash
git clone https://github.com/abhayyadav0090/AI.git
cd AI
npm install
cp .env.example .env
# Fill in the values in .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Name | Required | Where to get it |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB Atlas connection string. Use the `nexos` database name before the query string. |
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web) |
| `GEMINI_API_KEY` | Yes | [Google AI Studio](https://aistudio.google.com/apikey) |
| `JWT_SECRET` | Yes | A long, random secret string |
| `ALLOWED_ORIGINS` | Yes | Your site origin, for example `http://localhost:3000` |
| `GEMINI_MODEL` | No | Model name; defaults to the value configured by the server. |
| `GEMINI_FALLBACK_MODEL` | No | Second model used when the primary model is unavailable or over quota. |
| `PORT` | No | Defaults to `3000`. |

Setup notes:

- In Google Cloud Console, add your site and `http://localhost:3000` under **Authorised JavaScript origins**.
- In MongoDB Atlas, configure Network Access for your hosting environment. If using `0.0.0.0/0`, understand that it allows connections from any IP; use a strong database password and appropriate database permissions.
- Never commit `.env`; it should remain excluded by `.gitignore`.

---

## Deploy on Render

1. Push the project to GitHub.
2. In Render, choose **New → Blueprint** to use `render.yaml`, or create a **Web Service** with build command `npm install` and start command `npm start`.
3. Add the environment variables listed above.
4. After the first deploy, add the Render address to **Authorised JavaScript origins** in Google Cloud Console and to `ALLOWED_ORIGINS`.
5. Before releasing, run `npm test` on the complete merged project and verify the deployed app in the target desktop and mobile browsers.

---

## Project structure

```text
.
├── public/
│   ├── index.html              # Classic page structure and dialogs
│   ├── style.css               # Classic base layout and component styles
│   ├── design.css              # Google and Apple designs, light/dark tokens
│   ├── index-redesign.html     # Enterprise experience
│   ├── ui.js                   # Shared UI interactions and Classic controls
│   ├── app.js                  # Tasks, timer, habits, notes, analytics and NexAI
│   ├── attach.js               # NexAI attachment-picker/client handling
│   ├── manifest.json
│   └── favicon.svg
├── lib/                        # Server-side file validation/processing helpers
├── scripts/                    # Automated regression and performance checks
├── mds/
│   ├── API.md                  # API reference
│   ├── ARCHITECTURE.md         # Design and performance notes
│   └── DEPLOY-NEXOS-3.0.0.md  # Original 3.0.0 deployment guide
├── RELEASE-NOTES/
│   └── RELEASE-NOTES NexOS 3.0/
├── server.js                   # Express server: auth, state, chats and Gemini proxy
├── render.yaml                 # Render blueprint
├── package.json
├── package-lock.json
└── README.md
```

---

## API overview

All routes start with `/api`. Authentication is required for workspace and chat data routes; public configuration, health and authentication endpoints are exceptions. See [API.md](mds/API.md) for request shapes and error codes.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Server status |
| GET | `/api/config` | Public settings for the sign-in button |
| POST | `/api/auth/google` | Sign in with a Google credential |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/me` | Current user |
| GET | `/api/bootstrap` | Load account information and workspace data together |
| PUT | `/api/me` | Change the display name (`{ name }`) |
| DELETE | `/api/me` | Delete NexOS workspace data (body `{ confirm: "DELETE" }`) |
| GET, PUT | `/api/state` | Load and save workspace data |
| POST | `/api/chat` | Send a NexAI message, optionally with supported attachments, and save the chat |
| GET | `/api/chats`, `/api/chats/:id` | List and open saved chats |
| DELETE | `/api/chats/:id` | Delete a chat |
| POST | `/api/complete` | One-off AI prompt (insights, summaries) |

---

## Privacy

NexOS does not use advertising or tracking scripts. In guest mode, workspace data stays in the browser and NexAI is disabled. When signed in with Google, NexOS stores account and workspace information in MongoDB Atlas. AI requests are sent to the Google Gemini API. Uploaded files are processed for the relevant NexAI request and are not kept as permanent workspace files. See [Privacy](public/privacy.html) for the full details.

---

## Known limits

- The free Render server sleeps when idle, so the first request can be slow.
- The free Gemini quota is limited. When it runs out, NexAI may show a busy or quota message until capacity becomes available again.
- Due-date browser notifications depend on browser support and generally require NexOS to remain open. Background push delivery can be delayed if the hosting instance sleeps.
- Voice input depends on the browser's speech-recognition support and microphone permission. Support and language availability vary by browser and device; test the target phones and browsers before relying on it.
- File uploads are limited to 3 files and 6 MB combined per message. Supported files include PDF, PNG, JPG, WEBP and supported text/code formats. **DOCX is not currently supported; export Word documents to PDF first.**
- File attachments are available in the main NexAI chat. The Enterprise side-panel chat does not provide the same attachment control unless separately added.
- Files are not retained as permanent chat attachments. To ask follow-up questions about a file later, attach it again.
- Automated script checks do not replace real browser, microphone, camera, mobile-layout or end-to-end Gemini testing.

---

## License

Released under the MIT License.

---

## Legacy URL redirects

The server supports generic exact-path redirects configured through `LEGACY_REDIRECTS_JSON`. Configure redirects in Render environment variables when a legacy path needs to point elsewhere.

The delete-workspace action removes NexOS chats, workspace state and NexOS push subscriptions. It intentionally retains the shared Google identity record so independently deployed apps using the same identity collection do not lose access to their own records.

---

## Release history

### Earlier releases

- **2.0.1 — Daily task reminder time:** Signed-in users can choose a daily reminder time from the clock control beside the notification bell. The preference is stored separately in MongoDB and applies to in-app due notifications and server push reminders, using India Standard Time (`Asia/Kolkata`). The default is 09:00. The background scheduler polls every five minutes, so delivery is approximate; a sleeping Render Free instance can delay reminders.
- **2.1.0 — Editorial visual refresh:** Introduced the Ice Silver (`#DDE3E8`), Deep Aubergine (`#3A0F34`) and Marigold (`#FAA000`) design system across the dashboard, task board, habits, notes, analytics, focus timer and sign-in experience. Light and dark themes define their own surface, text, border, overlay and chart tokens.
- **2.1.1 — Dashboard quick actions:** Added Plan My Day, Ask NexAI and NexAI Action Mode to the dashboard. Action Mode continues to require explicit review before proposed changes are applied.
- **2.2.0 — Design, features and fixes:** Added switchable Google and Apple designs, a home screen with an Ask NexAI box, command palette (`Ctrl+K`), task list view, undo for deletes, autosaving notes, offline-friendly sign-in, per-user reminder time zones and server/app fixes. See `RELEASE-NOTES-2.2.0.md`.
- **2.4.0 — Two experiences:** Introduced Classic (`/` or `/classic`) and Enterprise (`/enterprise`). Both use the same sign-in and workspace data. Enterprise adds calendar, focus studio, a richer board and a NexAI panel. See `RELEASE-NOTES-2.4.0.md`.

### NexOS 3.x release series

- **3.0.0 — Performance foundation:** Added a unified authenticated bootstrap, leaner database reads, lazy-loaded analytics resources, scoped observers and versioned asset caching. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.0.md)
- **3.0.1 — Speed and responsiveness:** Added account-scoped cache-first startup, aligned Enterprise dashboard hydration, improved Recently Deleted navigation and reduced costly mobile visual effects. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.1.md)
- **3.0.2 — Scroll fixes:** Isolated modal scrolling from the page background, reset new Classic and Enterprise views to the top, and preserved page position when dialogs close. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.2.md)
- **3.0.3 — Recovery Center:** Redesigned Recently Deleted with clearer restore status, days-left indicators, an empty state and a mobile layout. Restore behaviour and 30-day retention remain unchanged. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.3.md)
- **3.1.0 — Cobalt Lime:** Added a sixth Enterprise theme using midnight black, electric cobalt blue and acid lime. The theme appears in the Enterprise theme list and persists after refresh. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.1.0.md)
- **3.1.1 — Faster PWA startup:** Updated the app-shell cache, improved cached shell and asset handling, deferred Classic scripts and corrected semantic-version asset cache headers. API responses are not cached as app-shell content. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.1.1.md)
- **3.2.0 — Voice input:** Added browser speech input to NexAI chat, Action Mode and supported Add Task inputs in Classic and Enterprise. The user can dictate without automatically submitting a prompt or approving an action. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.2.0.md)
- **3.3.0 — File upload for NexAI:** Added attachment support to the main NexAI chat in Classic and Enterprise, with a limit of 3 files and 6 MB combined per message. Supported PDFs, images and text/code files can be analysed or used for step-by-step assignment help. Files are validated by the server and are not retained as permanent workspace files. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.0.md)
- **3.3.1 — NexAI mobile layout and voice reliability:** Refined the mobile NexAI controls so Action Mode, New Chat, Workspace Context and Past Conversations are accessible from a compact control row. Context and history open in sheets, giving the chat more screen space. Improved Classic mobile spacing and fixed the floating action button overlap/extra page scroll described in the release work. Fixed duplicated speech text caused by browsers returning progressively longer recognition results; the current recognition session is reconstructed instead of appending every event. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.1.md)

---

## Release checks

Before publishing a release:

1. Keep the version consistent in `package.json`, `package-lock.json`, README, release notes, changelog and version-related tests.
2. Run `npm test` on the complete merged project.
3. Test Classic and Enterprise on desktop and mobile, including Google and Apple designs.
4. Test microphone permission, long dictation, multiple recognition results and language switching on supported browsers.
5. Test attachments with valid and invalid file types, the 3-file/6-MB limits, failed uploads and image analysis.
6. Confirm Recovery Center has not changed unless the release explicitly targets it.
