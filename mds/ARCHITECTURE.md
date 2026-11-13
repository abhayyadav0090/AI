# NexOS — Architecture & Design Decisions

Updated for NexOS 3.3.4. This document describes what the code does today. For request and response shapes see [API.md](API.md).

## System overview

```text
Browser
  Classic     index.html + style.css + design.css + ui.js + app.js + attach.js
  Enterprise  index-redesign.html (own inline script) + attach.js
  Shared      sw.js (service worker), push-client.js, recover.html, privacy.html
        |
        |  HTTPS, JSON, httpOnly cookie
        v
Express server (server.js, lib/attachments.js)
        |                       |                        |
        v                       v                        v
MongoDB Atlas           Google Gemini API        Browser push services
(users, workspace,      (key stays on the        (Web Push, VAPID keys)
 chats, push data)       server)
```

There is no build step and no frontend framework. Classic and Enterprise are two interfaces over the same account and the same saved workspace.

## Frontend

### Two experiences
- **Classic** (`/`, `/classic`): `index.html`, with Google and Apple designs (tokens in `design.css`, each with light, dark and auto themes).
- **Enterprise** (`/enterprise`): `index-redesign.html` with six themes chosen through `data-theme` and the `nexos_enterprise_theme` setting. It reads and writes the same saved workspace through a mapping layer (see `scripts/test-enterprise-bridge.js`).

### State and rendering
Classic keeps one `state` object: `tasks`, `habits`, `notes`, `pomodoroLog`, `pomodoroStats`, `dailyPlan`, `trash`, `dueNotificationsSeen`, `theme`, `design`, `currentNoteId`, `seeded`, `hideGuide`, `usedAI` and `profile`.

Every module follows **state → render → event**: an event handler changes `state`, calls `saveState()`, then calls the matching `render*()` function, which rewrites its part of the page.

Persistence:
- **Guest:** the browser only (`localStorage`). NexAI is disabled.
- **Signed in:** a local copy for fast first paint, synchronised to the server with `PUT /api/state`. Startup uses `GET /api/bootstrap` (identity and workspace in one request).

### Service worker and installability
`sw.js` caches the Classic app shell (cache name `nexos-shell-vN`, bumped every release) so the installed app starts quickly. Versioned assets (`?v=x.y.z`) are cached immutably by the server; `/enterprise` and other pages are fetched from the network first; `/api/*` requests are never cached as app-shell content.

### Voice and attachments
- **Voice (3.2.0):** the browser's speech recognition fills the input. Results are merged without repeating, and nothing is submitted automatically.
- **Attachments (3.3.0):** `attach.js` picks files, shrinks large photos on the device and sends base64 data with the chat message (see below).

## Backend

### Routes and limits
See [API.md](API.md). Body limit: 2 MB for every route, 9 MB for `POST /api/chat` only, applied after login and rate limits. Rate limits: 600 requests per 15 minutes per IP on `/api`; AI routes also allow 30 per minute and 500 per day per signed-in user.

### Data model
| Collection | Holds | Indexes |
|---|---|---|
| `User` | Google id, email, name, picture, session cut-off date | `googleId` (unique) |
| `UserState` | The user's whole workspace as one document | `userId` (unique) |
| `Chat` | Title and up to 200 messages (`role`, `content`, `ts`); up to 100 chats per user | `{ userId, updatedAt: -1 }` |
| `PushSubscription` | Browser push subscription | `endpoint` (unique), `userId`, `{ userId, updatedAt: -1 }` |
| `PushPreference` | Reminder time, on/off, time zone | `userId` (unique) |

### NexAI flow
1. The browser builds a context summary from the workspace and sends the message, with attachments if any, to `POST /api/chat`.
2. The server loads the chat, takes the latest 40 messages as history and calls Gemini with the server-side key. It retries a temporary failure and can switch to `GEMINI_FALLBACK_MODEL`.
3. Only if the call succeeds, the message and reply are saved. A failure leaves the chat unchanged.
4. **Action Mode** asks for proposed changes and applies only the ones the user approves.

### Attachments
`lib/attachments.js` accepts up to 3 files and 6 MB in total. It identifies each file by its content (PDF, PNG, JPEG and WEBP signatures; text and code files by extension with no binary bytes), cuts text at 60,000 characters and sends the files to Gemini with that one message. File bytes are never saved; the chat keeps the message and file names. File text is treated as data, not as instructions.

### Reminders
A timer inside the server process runs every five minutes, finds users whose reminder time has arrived in their own time zone and sends Web Push messages. Push needs the three `VAPID_*` variables.

## Security model

- **API key:** the Gemini key lives only on the server.
- **Sign-in:** the server verifies the Google credential and issues a 7-day JWT in an `httpOnly`, `SameSite=Lax` cookie, `Secure` in production or on HTTPS. Deleting a workspace invalidates earlier cookies.
- **Origin check:** other origins get `403` unless listed in `ALLOWED_ORIGINS`.
- **CSP:** set with Helmet; the full list is in the README's Security notes.
- **Output escaping:** user and AI text is escaped (`escHtml`) before it is placed in the page.
- **Attachments:** validated by content on the server, limited by count and size, never stored.

### Security hardening plan (planned, not implemented)
The current CSP allows inline scripts and inline event handlers (`'unsafe-inline'`). A stricter policy would be shipped as its own release, so it can be reverted on its own:
1. List every inline `<script>` block and inline event handler in `index.html`, `index-redesign.html` and `recover.html`.
2. Move the handlers to `addEventListener`, and put each remaining inline script under a nonce or hash.
3. Remove `'unsafe-inline'` from `script-src` and `script-src-attr`, then look at `style-src`.
4. Remove the Gemini address from `connect-src` once nothing in the browser calls it, and review `img-src https:`.
5. Check the effective header in browser DevTools and test Google sign-in, Chart.js loading, the service worker, push, attachments, both designs and both experiences.
6. Add a regression test that fails if `'unsafe-inline'` comes back.

## Performance decisions

**3.0.0**
- **One startup request:** `GET /api/bootstrap` returns identity and workspace together.
- **Lean reads:** authentication and workspace reads use Mongoose `lean()`; workspace reads select only `data`.
- **On-demand charts:** Chart.js loads the first time Analytics opens.
- **Scoped observers:** mutation observers watch dialog roots, not the whole document.
- **Asset caching:** versioned CSS and JS use immutable caching; HTML uses a short cache lifetime.
- **Reduced background work:** the Enterprise clock refreshes every 15 seconds, and independent startup requests run concurrently.

**Later**
- **3.0.1:** account-scoped cache-first startup and lighter mobile effects.
- **3.1.1:** cache-first app shell, deferred Classic scripts and correct semantic-version cache headers.
- **3.3.3 and 3.3.4:** the phone NexAI page is sized from the real space between the top bar and the bottom nav, so the page itself does not scroll.

No load tests or benchmarks have been run, so NexOS makes no throughput claims. Measure in the deployed browser with DevTools Performance and Network panels.

## Scaling notes

Current design: one server instance, one MongoDB database, no cache layer such as Redis (none is needed at this scale).

- **Indexes:** every read is by `userId`, `googleId` or `endpoint`, and all three are indexed (table above). Listing chats uses the compound index.
- **Workspace size:** each user's workspace is one document. A save request is limited to 2 MB, and a MongoDB document is limited to 16 MB. A very large workspace would need splitting into several documents.
- **Chats:** capped at 200 messages per chat and 100 chats per user.
- **Rate limits** use the default in-memory store: they reset on restart and are per instance. With more than one instance, use a shared store.
- **Reminders** run from an in-process timer, and each sweep reads the distinct users with a subscription. With more than one instance, run the timer on one instance only (or move it to a separate worker) so reminders are not sent twice.
- **Sessions** are stateless JWTs, so they work across instances.
- **Render Free** sleeps when idle, so the first request can take up to a minute and reminders can be delayed.

## Design system

- **Classic:** two designs, **Google** (Material 3) and **Apple** (liquid glass), each with light, dark or match-device themes. Colours, spacing and shapes are tokens in `design.css`.
- **Enterprise:** six themes: Apple Glass, Material, Apple Light, M3, Overgame (default) and Cobalt Lime.
- **Motion:** transitions use `transform` and `opacity`, and heavy visual effects are reduced on phones.
