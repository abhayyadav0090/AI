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
│  │Analytics │ │Dashboard │ │       AI Coach            │       │
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
                          │  Anthropic Claude   │
                          │   (claude-sonnet-4) │
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
The AI Coach module:
1. Builds a rich system prompt from current `state` (`buildSystemContext()`)
2. Maintains a local `chatHistory` array for multi-turn context
3. Sends history + system prompt to `/api/chat` (backend) or directly to Anthropic (standalone mode)
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
              └──► (if AI call) → /api/chat → Claude → appendChatMsg()
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
- [ ] Claude streaming (SSE) for AI responses
- [ ] Multi-user mode with JWT auth
- [ ] PostgreSQL backend for data persistence
- [ ] Mobile app via Capacitor
