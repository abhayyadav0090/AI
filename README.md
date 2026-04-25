# ✦ NexOS — AI-Powered Personal Productivity OS

<div align="center">

![NexOS Banner](https://img.shields.io/badge/NexOS-AI%20Productivity%20OS-a78bfa?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJMMiA3bDEwIDUgMTAtNS0xMC01ek0yIDE3bDEwIDUgMTAtNS0xMC01LTEwIDV6Ii8+PC9zdmc+)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express)
![Anthropic](https://img.shields.io/badge/Claude-Sonnet%204-cc785c?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-22d3ee?style=for-the-badge)

**A full-stack, AI-powered productivity operating system built with vanilla JS, Node.js/Express, and the Anthropic Claude API.**

[🚀 Live Demo](#) · [📸 Screenshots](#screenshots) · [🛠 Tech Stack](#tech-stack) · [⚡ Quick Start](#quick-start)

</div>

---

## 🌟 Overview

NexOS is a feature-complete, single-page productivity application that combines the best productivity methodologies with modern AI assistance. It runs entirely in the browser (frontend) with an optional Node.js backend for secure API proxying.

Built as a showcase of full-stack web development, modern UX design, and practical AI integration — this is the kind of tool that *actually gets used daily.*

---

## ✨ Features

### 📋 Kanban Board
- Drag-and-drop task cards across **Todo → In Progress → Review → Done** columns
- Per-task priority levels (High / Medium / Low) with color coding
- Due dates, descriptions, and AI-assisted task suggestions
- Real-time task count badges per column

### ⏱ Pomodoro Focus Timer
- Animated SVG ring timer with work / short break / long break cycles
- Auto-advance between sessions with configurable durations
- Session logging with daily focus minutes tracked
- Mini timer widget on the Dashboard

### 🔥 Habit Tracker
- Build streaks with daily check-in system
- Custom habit colors and emoji labels
- 28-day heatmap calendar showing completion history
- Streak counters and completion percentages

### 📝 Smart Notes
- Markdown-aware rich text editor
- Tag system with multi-tag filtering
- Pin important notes to the top
- Word count and auto-save indicators

### 📊 Analytics Dashboard
- **Daily Focus Time** — bar chart (Chart.js) for the last 7/14/30 days
- **Task Status** — donut chart showing todo/in-progress/review/done split
- **Habit Completion** — per-habit progress bars with percentage scores
- **Productivity Score** — composite SVG ring score (0–100) based on all modules
- **Weekly Task Velocity** — line chart comparing task throughput

### 🤖 AI Coach (Powered by Claude)
- Full conversation history with context awareness
- Receives live snapshot of your tasks, habits, focus time, and notes
- Suggested prompts: analyze your week, prioritize tasks, plan your day, suggest habits
- Daily AI insight on the Dashboard
- AI-assisted task descriptions in the Kanban modal

### 🎨 Design System
- **Dark glassmorphism** aesthetic with neon accents (violet, cyan, emerald)
- Animated ambient background orbs + subtle grid overlay
- Full **light / dark theme toggle**
- Responsive layout — sidebar collapses on mobile
- Keyboard shortcuts: `Ctrl+1–7` to jump between views, `Ctrl+S` to save note, `Esc` to close modals

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JavaScript (ES2022), HTML5, CSS3 |
| **Styling** | Custom CSS with CSS Variables, Glassmorphism, CSS Animations |
| **Charts** | Chart.js 4.x |
| **Fonts** | Syne (display), Outfit (body), JetBrains Mono (data) |
| **Backend** | Node.js 18+, Express 4.x |
| **AI** | Anthropic Claude Sonnet 4 API |
| **Security** | Helmet.js, express-rate-limit, CORS |
| **Performance** | Compression middleware, Morgan logging |
| **Storage** | localStorage (client-side persistence, no database required) |
| **Deployment** | Railway / Render / Fly.io / VPS |

---

## ⚡ Quick Start

### Option A — Frontend Only (No backend needed)
The app works 100% in the browser. You'll need to add your Anthropic API key directly in `public/app.js` (search for `callClaude`). Not recommended for production.

```bash
# Just open index.html in your browser — done!
open public/index.html
```

### Option B — Full Stack (Recommended)

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/nexos-ai-productivity-os.git
cd nexos-ai-productivity-os

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 4. Start the development server
npm run dev

# 5. Open the app
open http://localhost:3000
```

---

## 🌍 Deployment

### Deploy to Railway (Recommended — Free tier)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=your_key_here
```

### Deploy to Render
1. Connect your GitHub repo at [render.com](https://render.com)
2. Set **Build Command**: `npm install`
3. Set **Start Command**: `npm start`
4. Add environment variable: `ANTHROPIC_API_KEY`

### Deploy to Fly.io
```bash
# Install flyctl, then:
fly launch
fly secrets set ANTHROPIC_API_KEY=your_key_here
fly deploy
```

### Deploy to a VPS (Ubuntu/Debian)
```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone & install
git clone ... && cd nexos-ai-productivity-os
npm install --production

# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name nexos
pm2 startup && pm2 save

# Nginx reverse proxy (see nginx.conf in /docs)
```

---

## 📁 Project Structure

```
nexos-ai-productivity-os/
├── public/
│   ├── index.html          # Main SPA shell + all view templates
│   ├── style.css           # Complete design system (1700+ lines)
│   └── app.js              # All frontend modules (1000+ lines)
├── server.js               # Express backend — API proxy + static server
├── package.json            # Dependencies & scripts
├── .env.example            # Environment variable template
├── .gitignore
├── Dockerfile              # Container deployment
├── nginx.conf              # Production Nginx config
├── docs/
│   ├── ARCHITECTURE.md     # System design decisions
│   └── API.md              # Backend API reference
└── README.md
```

---

## 🔌 API Reference

All endpoints are prefixed with `/api`.

### `GET /api/health`
Returns server status and uptime.

### `POST /api/chat`
Proxies multi-turn conversation to Claude.

**Body:**
```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "system": "You are a productivity coach.",
  "max_tokens": 1000
}
```

**Response:** `{ "text": "...", "usage": { ... } }`

### `POST /api/complete`
Single-shot prompt completion.

**Body:** `{ "prompt": "...", "system": "..." }`

**Response:** `{ "text": "..." }`

---

## 🎯 Architecture Decisions

- **No framework** — Vanilla JS keeps the bundle zero-dependency on the frontend, loads instantly, and demonstrates DOM mastery without abstraction layers.
- **localStorage persistence** — No database needed; all user data lives client-side, making the app privacy-first and deployment-simple.
- **Backend as API proxy** — The Node.js server keeps the Anthropic API key secret and adds rate limiting; the frontend can also call Claude directly when running standalone.
- **Modular JS** — Each feature (kanban, pomodoro, habits, notes, analytics, AI) is a self-contained section in `app.js` with a clear state → render → event pattern.
- **CSS Variables design system** — Every color, spacing, and font is a variable; the entire theme switches in one class toggle.

---

## 📸 Screenshots

| Dashboard | Kanban Board | AI Coach |
|:---:|:---:|:---:|
| Stats, widgets, mini timer | Drag-and-drop task columns | Claude-powered chat |

| Habit Tracker | Analytics | Focus Timer |
|:---:|:---:|:---:|
| Streaks + heatmap | Charts + productivity score | Animated ring timer |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Fork → Clone → Branch
git checkout -b feature/your-feature-name

# Make changes → Commit → Push
git commit -m "feat: add your feature"
git push origin feature/your-feature-name

# Open a Pull Request on GitHub
```

---

## 📄 License

MIT © 2025 — Free to use, modify, and deploy. Attribution appreciated.

---

<div align="center">
  Built with ☕ and ✦ Claude AI · <strong>NexOS v2.0</strong>
</div>
