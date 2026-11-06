# NexOS — Architecture & Design Decisions

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
│                                                                 │
│  index.html ──► style.css ──► app.js                           │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  Kanban  │ │Pomodoro  │ │ Habits   │ │  Notes   │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐       │
│  │Analytics │ │Dashboard │ │       NexAI            │       │
│  └──────────┘ └──────────┘ └──────────────────────────┘       │
│                                    │                            │
│                            localStorage ◄── State Manager      │
└────────────────────────────────────┼────────────────────────────┘
                                     │ POST /api/chat
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js / Express Backend                    │
│                                                                 │
│  server.js                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Rate Limiter│  │  CORS Guard  │  │  Helmet (Security)   │  │
│  └─────────────┘  └──────────────┘  └──────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │             POST /api/chat  ·  POST /api/complete         │ │
│  │                  API Key injected server-side             │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────┘
                                     │ HTTPS
                                     ▼
                          ┌─────────────────────┐
                          │  Google Gemini     │
                          │   (gemini flash)  │
                          └─────────────────────┘
```

## Module Architecture

### State Management
All application state lives in a single `state` object:
```javascript
{
  tasks: Task[],
  habits: Habit[],
  notes: Note[],
  pomodoroLog: PomLog[],
  pomodoroStats: PomStats,
  theme: 'dark' | 'light',
  currentNoteId: string | null
}
```
State is persisted to `localStorage` on every mutation via `saveState()`.

### Rendering Pattern
Each module follows: **State → Render → Event**
1. User action triggers an event handler
2. Handler mutates `state` directly
3. Handler calls `saveState()` then the relevant `render*()` function
4. Render function reads from `state` and rewrites the relevant DOM subtree

No virtual DOM, no framework — just direct, performant DOM manipulation.

### AI Integration
The NexAI module:
1. Builds a rich system prompt from current `state` (`buildSystemContext()`)
2. Saves every chat on the server (MongoDB `Chat` collection) so history survives refreshes and new devices
3. Sends history + system prompt to `/api/chat` (backend proxy to Google Gemini)
4. Streams the response back and appends to the chat UI

### Data Flow
```
User Action
    │
    ▼
Event Handler (in app.js)
    │
    ├──► mutate state[]
    ├──► saveState() → localStorage
    └──► render*() → DOM update
              │
              └──► (if AI call) → /api/chat → Gemini → appendChatMsg()
```

## Security Model

### API Key Protection
- In **backend mode**: API key lives in `.env`, never sent to the browser
- In **standalone mode**: Key must be hardcoded (dev only, never commit)
- Rate limiting: 20 AI requests/minute per IP

### Content Security
- Helmet.js sets restrictive CSP headers
- All user-generated content is escaped with `escHtml()` before DOM insertion
- No `eval()`, no `innerHTML` with raw user input

## Performance

- **No build step** — zero bundler overhead, instant dev iteration
- **Single HTML file** — one network request for the shell
- **Lazy rendering** — views only render their data when switched to
- **Chart.js CDN** — loaded from jsDelivr with long cache headers
- **CSS transitions** — GPU-composited `transform` and `opacity` only

## Design System

### Color Palette
| Variable | Value | Usage |
|---|---|---|
| `--bg-void` | `#05050a` | Page background |
| `--bg-surface` | `#0f0f1a` | Panel backgrounds |
| `--accent-violet` | `#a78bfa` | Primary actions |
| `--accent-cyan` | `#22d3ee` | Secondary highlights |
| `--accent-emerald` | `#10b981` | Success / done |
| `--accent-amber` | `#f59e0b` | Warning / medium priority |
| `--accent-rose` | `#f43f5e` | Danger / high priority |

### Typography Scale
- **Display**: Syne 700/800 — headings, logo, section titles
- **Body**: Outfit 300/400/500 — UI text, descriptions
- **Mono**: JetBrains Mono 300/400 — times, stats, code

## Future Enhancements

- [ ] WebSocket real-time sync across tabs
- [ ] Calendar view with drag scheduling
- [ ] Markdown export for notes
- [ ] PWA with offline support + install prompt
- [ ] Gemini streaming (SSE) for AI responses
- [ ] Multi-user mode with JWT auth
- [ ] PostgreSQL backend for data persistence
- [ ] Mobile app via Capacitor


## NexOS 3.0.0 performance decisions

- **Single startup bootstrap:** signed-in Classic and Enterprise pages use `GET /api/bootstrap` to fetch the public account identity and workspace snapshot in one HTTP request. The existing `/api/me` and `/api/state` endpoints remain available for compatibility and later sync operations.
- **Lean read-only queries:** authentication and workspace reads use Mongoose `lean()` results; workspace reads select only `data`.
- **On-demand charts:** Chart.js is fetched the first time Analytics is opened rather than during initial page loading. Enterprise celebration confetti is fetched only after the first completed task.
- **No unused pointer work:** the former Enterprise mouse spotlight performed a document-wide card scan and layout reads on every mouse event, while its generated CSS variables were unused; that work has been removed.
- **Scoped dialog observers:** mutation observers watch dialog roots rather than every class/style change across the full document.
- **Static asset caching:** versioned CSS/JS assets use immutable caching, while HTML uses a short cache lifetime so deployments are picked up promptly.
- **Reduced background updates:** Enterprise's visible clock refreshes every 15 seconds (the display shows minutes) and independent non-critical startup requests run concurrently.

These changes target identified avoidable work. Runtime improvements should still be measured in the deployed browser using DevTools Performance and Network panels, since this source-only environment cannot reproduce each user's device, browser extensions, network, or Render latency.
