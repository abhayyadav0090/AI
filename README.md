# NexOS: AI Productivity Workspace

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white) ![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white) ![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-22d3ee?style=flat-square)

NexOS is a web workspace for planning your day and staying focused. It combines a Kanban board, focus timer, habit tracker, notes and analytics with **NexAI**, an assistant powered by Google Gemini that can work with your tasks, habits, focus activity and notes.

**Current source release: 3.3.4.** The 3.x series focuses on performance, mobile usability, reliable navigation and a more capable NexAI experience while preserving existing NexOS features and workspace data.

**Live demo:** [https://ai-aqit.onrender.com](https://ai-aqit.onrender.com)

The demo runs on a free server, so its first load after inactivity can take up to a minute.

NexOS is developed independently, with AI used as a pair-programming tool.

**Classic**

| Google design | Apple design |
|:---:|:---:|
| ![Dashboard, Google design](docs/screenshots/dashboard.png) | ![Dashboard, Apple design](docs/screenshots/dashboard-apple.png) |

**Enterprise**

| Dashboard | Apple Glass theme |
|:---:|:---:|
| ![Enterprise dashboard](docs/screenshots/enterprise-dashboard.png) | ![Enterprise dashboard, Apple Glass theme](docs/screenshots/enterprise-apple-glass.png) |

**Tasks and NexAI**

| Kanban | NexAI |
|:---:|:---:|
| ![Kanban board](docs/screenshots/kanban.png) | ![NexAI chat](docs/screenshots/nexai.png) |

**On a phone**

| Classic, Google design | Classic, Apple design | Enterprise |
|:---:|:---:|:---:|
| ![Classic on a phone, Google design](docs/screenshots/mobile.png) | ![Classic on a phone, Apple design](docs/screenshots/mobile-apple.png) | ![Enterprise on a phone](docs/screenshots/enterprise-mobile.png) |

**NexAI, voice and Recently deleted on a phone**

| Classic NexAI | Enterprise NexAI: file attached, mic beside it | Action Mode with a mic | Recently deleted |
|:---:|:---:|:---:|:---:|
| ![Classic NexAI on a phone](docs/screenshots/classic-nexai.png) | ![Enterprise NexAI on a phone with an attached file and a microphone button](docs/screenshots/enterprise-nexai-attach.png) | ![NexAI Action Mode with a microphone button](docs/screenshots/enterprise-action-mode.png) | ![Recently deleted page](docs/screenshots/recovery-center.png) |

*All screenshots were taken in guest mode with sample data, not a real account. The NexAI conversation in the Classic desktop screenshot is an example written for this README, and the phone NexAI screenshots show the guest sign-in prompt.*

---

## Features

### Classic and Enterprise

- Two experiences on one account and one set of data. **Classic** (`/` and `/classic`) is the simple, focused version. **Enterprise** (`/enterprise`, also `/redesign`) adds a timeblocking calendar, a focus studio with ambient sound, a richer Kanban board, analytics and a NexAI side panel.
- Switch between them from the Classic | Enterprise control in the top bar or the quick appearance menu.
- Enterprise has six themes: Apple Glass, Material, Apple Light, M3, Overgame (the default) and Cobalt Lime.

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
- **Focus on a task:** each open task has a play button that moves it to In Progress and starts a focus session. When the session ends, NexOS asks whether the task is done.

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

### Reminders and recovery

- Task reminders for due and overdue tasks can be turned on or off. The daily reminder time is configurable (default 09:00, India Standard Time) and applies to in-app notifications and background Web Push alerts.
- **Recently deleted:** deleted tasks, habits and notes (in Enterprise, tasks and habits) are kept in your account for 30 days, up to 30 items, and can be restored from any device. This is the Recovery Center page.

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
- **Quick-start:** a new workspace asks once what you will use NexOS for (study and exams, projects and sprints, daily routine and habits, or just exploring). The answer sets the starter data, the default focus timer and the order of the dashboard cards.
- Responsive layouts with bottom navigation on phones.
- Installable web app: a service worker caches the app shell for faster startup. API responses are not cached as app-shell content.
- A privacy page at `/privacy.html`.
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
| `NODE_ENV` | No | `development` for local use, `production` on a server. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | No | Needed only for push reminders. Create the pair with `node scripts/generate-vapid-keys.js`. |
| `VAPID_SUBJECT` | No | Contact for push services, for example `mailto:you@example.com`. |
| `LEGACY_REDIRECTS_JSON` | No | Exact-path redirects for old URLs; see Server notes below. |

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

### Other ways to deploy

- **Docker:** `Dockerfile` builds the app on Node 20 Alpine. `docker-compose.yml` runs it on port 3000 with a health check at `/api/health`. It passes only the core variables, so add the `VAPID_*` variables to the file if you want push reminders.
- **Nginx:** `docker-compose.yml` also defines an optional Nginx service, started with `docker-compose --profile production up` and configured by `nginx.docker.conf`. `nginx.conf` is an example production config for a server with Nginx and Certbot SSL.
- **Vercel:** `vercel.json` sends every request to `server.js` through `@vercel/node` and includes the `public` folder.

---

## Project structure

```text
.
├── public/
│   ├── index.html              # Classic page structure and dialogs
│   ├── index-redesign.html     # Enterprise experience (served at /enterprise)
│   ├── style.css               # Classic base layout and component styles
│   ├── design.css              # Google and Apple designs, light/dark tokens
│   ├── ui.js                   # Shared UI interactions and Classic controls
│   ├── app.js                  # Tasks, timer, habits, notes, analytics and NexAI
│   ├── attach.js               # NexAI attachment-picker/client handling
│   ├── push-client.js          # Browser side of push reminders
│   ├── sw.js                   # Service worker (app-shell cache)
│   ├── recover.html            # Recovery Center (Recently deleted)
│   ├── privacy.html            # Privacy page
│   ├── manifest.json           # Web app manifest
│   ├── favicon.svg
│   ├── nexos-icon-192.png
│   └── nexos-icon-512.png
├── lib/
│   └── attachments.js          # Server-side file validation for NexAI chat
├── scripts/                    # generate-vapid-keys.js and the regression tests run by npm test
├── mds/
│   ├── API.md                  # API reference
│   ├── ARCHITECTURE.md         # Design and performance notes
│   └── DEPLOY-NEXOS-3.0.0.md   # Original 3.0.0 deployment guide
├── docs/
│   └── screenshots/            # Images used in this README
├── RELEASE-NOTES/
│   ├── RELEASE-NOTES NexOS 1.0/
│   ├── RELEASE-NOTES NexOS 2.0/
│   └── RELEASE-NOTES NexOS 3.0/
├── server.js                   # Express server: auth, state, chats and Gemini proxy
├── render.yaml                 # Render blueprint
├── Dockerfile                  # Container image (Node 20 Alpine)
├── docker-compose.yml          # App container, optional Nginx service
├── nginx.conf                  # Example Nginx production config
├── nginx.docker.conf           # Nginx config used by Docker Compose
├── vercel.json                 # Vercel routing
├── .env.example                # Template for environment variables
├── .gitignore
├── .dockerignore
├── package.json
├── package-lock.json
├── LICENSE
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
| GET | `/api/push/config` | Public key the browser needs to subscribe to push reminders |
| GET, PUT | `/api/push/preferences` | Load and save reminder preferences (on/off, time, time zone) |
| POST, DELETE | `/api/push/subscribe` | Subscribe or unsubscribe this browser from push reminders |
| POST | `/api/push/test` | Send a test push notification |

---

## Privacy

NexOS does not use advertising or tracking scripts. In guest mode, workspace data stays in the browser and NexAI is disabled. When signed in with Google, NexOS stores account and workspace information in MongoDB Atlas. AI requests are sent to the Google Gemini API. Uploaded files are processed for the relevant NexAI request and are not kept as permanent workspace files. See [Privacy](https://ai-aqit.onrender.com/privacy.html) for the full details.

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

## Server notes

**Legacy URL redirects.** The server supports generic exact-path redirects configured through `LEGACY_REDIRECTS_JSON`. Configure redirects in Render environment variables when a legacy path needs to point elsewhere.

The delete-workspace action removes NexOS chats, workspace state and NexOS push subscriptions. It intentionally retains the shared Google identity record so independently deployed apps using the same identity collection do not lose access to their own records.

---

## License

Released under the MIT License.

---

## Release history

### NexOS 1.x release series

- **1.0 — Front-end only:** NexOS began in March 2026 from a simple HTML and CSS assignment, a "Daily Routine Timeline" web page. The first versions had no server. They were a front-end app with a Kanban board, a to-do list and a focus timer. The look and themes were changed several times during this phase. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%201.0/RELEASE-NOTES-1.0.md)
- **1.1 — Google sign-in and NexAI:** By the end of the 1.1 series, Google sign-in and the NexAI assistant had been added. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%201.0/RELEASE-NOTES-1.1.md)

Per-version notes were not kept for the 1.x phase, so these two entries summarise the series.

### NexOS 2.x release series

- **2.0.1 — Daily task reminder time:** Signed-in users can choose a daily reminder time from the clock control beside the notification bell. The preference is stored separately in MongoDB and applies to in-app due notifications and server push reminders, using India Standard Time (`Asia/Kolkata`). The default is 09:00. The background scheduler polls every five minutes, so delivery is approximate; a sleeping Render Free instance can delay reminders.
- **2.0.2 — Task reminder on/off:** Added a saved on/off setting for due-date and overdue-task reminders. It controls both local browser notifications and background Web Push alerts. Turning reminders off does not delete tasks or revoke browser notification permission. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.0.2.md)
- **2.1.0 — Editorial visual refresh:** Introduced the Ice Silver (`#DDE3E8`), Deep Aubergine (`#3A0F34`) and Marigold (`#FAA000`) design system across the dashboard, task board, habits, notes, analytics, focus timer and sign-in experience. Light and dark themes define their own surface, text, border, overlay and chart tokens.
- **2.1.1 — Dashboard quick actions:** Added Plan My Day, Ask NexAI and NexAI Action Mode to the dashboard. Action Mode continues to require explicit review before proposed changes are applied.
- **2.2.0 — Design, features and fixes:** Added two switchable designs, Google (Material 3) and Microsoft (Fluent 2), each with light, dark and match-device themes, plus real SVG icons, a phone bottom navigation bar with a floating New button, a home screen with an Ask NexAI box, a command palette (`Ctrl+K`), a task list view, undo for deletes, autosaving notes, offline-friendly sign-in, per-user reminder time zones and server/app fixes. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.2.0.md)
- **2.2.1 — Deep audit fixes:** Made NexAI Action Mode dismissible while it waits for a slow AI response (closing it or pressing Esc cancels the request), and corrected the Profile deletion text to explain that workspace data is deleted while the shared Google identity record is kept. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.2.1.md)
- **2.3.0 — Dual experience:** Kept Classic at `/` and added Enterprise at `/enterprise` (also `/redesign`). Both use the same signed-in workspace, with a Classic/Enterprise switch in both interfaces. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.3.0.md)
- **2.3.1 — Enterprise-first polish:** Made Enterprise the default home route with Classic at `/classic`, added a visible Classic/Enterprise switch, made Overgame the default Enterprise theme, and fixed the Enterprise profile card and mobile sidebar layering. Classic returned to `/` in 2.4.0. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.3.1.md)
- **2.3.2 — Cloud reliability improvements:** Built on 2.3.1 and adopted the improved responsive Classic interface and per-user reminder time-zone storage from the Cloud 2.2.0 build, keeping Enterprise-first routing. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.3.2.md)
- **2.4.0 — Two experiences:** Classic (`/` and `/classic`) stays the simple version. Enterprise (`/enterprise`) adds a timeblocking calendar, a focus studio with ambient sound, a richer Kanban board, analytics and a NexAI side panel. Both use the same account and data, and the assistant is called NexAI everywhere. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.4.0.md)
- **2.4.1 — Chat and greeting fixes:** Fixed "Chat not found" in Enterprise when the remembered conversation had been deleted, stopped the Classic greeting wrapping onto two lines, and made Overgame the starting Enterprise theme for new accounts. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.4.1.md)
- **2.4.2 — Experience switch in the appearance menu:** Added the Classic | Enterprise switch to the quick appearance menu, which matters most on phones, and fixed long note or task titles stretching the page sideways on a phone. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.4.2.md)
- **2.5.0 — Apple design replaces Microsoft:** The second design is now Apple, a liquid-glass look with frosted panels, capsule buttons and iOS-style segmented switches. Screens and features stay the same. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.0.md)
- **2.5.1 — Phone fixes for Enterprise:** Fixed the Classic | Enterprise switch being cut off at the bottom of the menu on Chrome and centred the menu button icon. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.1.md)
- **2.5.2 — Safer habit deletes:** Deleting a habit now asks first and shows an Undo message for 9 seconds, and Enterprise habit rows no longer overlap on phones. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.2.md)
- **2.5.3 — Recently deleted:** Deleted tasks, habits and notes (in Enterprise, tasks and habits) are kept in your account for 30 days, up to 30 items, and can be restored from any device. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.3.md)
- **2.5.4 — Quick-start:** A new workspace asks once what you will use NexOS for (study and exams, projects and sprints, daily routine and habits, or exploring). The answer sets the starter data, the default focus timer and the card order. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.4.md)
- **2.5.5 — Quick-start on Enterprise:** Enterprise dashboard cards follow your goal, and Enterprise Settings gets a "Your setup" goal picker. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.5.md)
- **2.5.6 — Stale-tab guard:** Answering the quick-start on a second open screen no longer brings back deleted starter items. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.6.md)
- **2.5.7 — Better first day:** "Get insight" now works in guest mode, and the Productivity score card shows first-day steps (check a habit, finish a task, complete a focus session). [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.7.md)
- **2.5.8 — Focus on a task:** Each open task has a play button that moves it to In Progress and starts a focus session, with a "Done with it?" prompt when the session ends. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.8.md)
- **2.5.9 — A shorter Settings page:** Settings opens as a short list of folded rows, with Your setup at the top. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.5.9.md)
- **2.6.0 — Settings on laptops:** On screens 901 px and wider Settings shows every section open with the large Google and Apple preview cards. Phones keep the short list. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%202.0/RELEASE-NOTES-2.6.0.md)

### NexOS 3.x release series

- **3.0.0 — Performance foundation:** Added a unified authenticated bootstrap, leaner database reads, lazy-loaded analytics resources, scoped observers and versioned asset caching. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.0.md)
- **3.0.1 — Speed and responsiveness:** Added account-scoped cache-first startup, aligned Enterprise dashboard hydration, improved Recently Deleted navigation and reduced costly mobile visual effects. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.1.md)
- **3.0.2 — Scroll fixes:** Isolated modal scrolling from the page background, reset new Classic and Enterprise views to the top, and preserved page position when dialogs close. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.2.md)
- **3.0.3 — Recovery Center:** Redesigned Recently Deleted with clearer restore status, days-left indicators, an empty state and a mobile layout. Restore behaviour and 30-day retention remain unchanged. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.0.3.md)
- **3.1.0 — Cobalt Lime:** Added a sixth Enterprise theme using midnight black, electric cobalt blue and acid lime. The theme appears in the Enterprise theme list and persists after refresh. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.1.0.md)
- **3.1.1 — Faster PWA startup:** Updated the app-shell cache, improved cached shell and asset handling, deferred Classic scripts and corrected semantic-version asset cache headers. API responses are not cached as app-shell content. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.1.1.md)
- **3.2.0 — Voice input:** Added browser speech input to NexAI chat, Action Mode and supported Add Task inputs in Classic and Enterprise. The user can dictate without automatically submitting a prompt or approving an action. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.2.0.md)
- **3.3.0 — File upload for NexAI:** Added attachment support to the main NexAI chat in Classic and Enterprise, with a limit of 3 files and 6 MB combined per message. Supported PDFs, images and text/code files can be analysed or used for step-by-step assignment help. Files are validated by the server and are not retained as permanent workspace files. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.0.md)
- **3.3.1 — NexAI mobile layout and voice reliability:** Refined the mobile NexAI controls so Action Mode, New Chat, Workspace Context and Past Conversations are accessible from a compact control row. Context and history open in sheets, giving the chat more screen space. In Classic, fixed the floating Add button overlapping the send button and unwanted page scrolling in the Apple design. Fixed duplicated speech text caused by browsers returning progressively longer recognition results; the current recognition session is reconstructed instead of appending every event. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.1.md)
- **3.3.2 — Mobile voice and send reliability:** Stopped dictation from forcing the keyboard open and blocked overlapping sends in the NexAI chat and floating Copilot. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.2.md)
- **3.3.3 — NexAI fit and keyboard:** Made the phone Enterprise NexAI page fit the screen exactly and kept the keyboard closed after dictation until you tap the message box. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.3.md)
- **3.3.4 — Classic NexAI exact fit:** Sized the phone Classic NexAI page from the real space between the top bar and the bottom nav, so it no longer scrolls under the top bar in any design or theme. [Release notes](RELEASE-NOTES/RELEASE-NOTES%20NexOS%203.0/RELEASE-NOTES-3.3.4.md)

---

## Release checks

Before publishing a release:

1. Keep the version consistent in `package.json`, `package-lock.json`, README, release notes, changelog and version-related tests.
2. Run `npm test` on the complete merged project.
3. Test Classic and Enterprise on desktop and mobile, including Google and Apple designs.
4. Test microphone permission, long dictation, multiple recognition results and language switching on supported browsers.
5. Test attachments with valid and invalid file types, the 3-file/6-MB limits, failed uploads and image analysis.
6. Confirm Recovery Center has not changed unless the release explicitly targets it.
