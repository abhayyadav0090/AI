/**
 * NexOS — Backend Server
 * Express.js API proxy for Anthropic Claude + static file serving
 * Handles: API key security, rate limiting, CORS, compression
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');
const morgan     = require('morgan');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & middleware ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit exceeded. Please wait a moment.' },
});

app.use(globalLimiter);

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    node: process.version,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

app.get('/api/debug', (req, res) => {
  res.json({
    hasKey: !!process.env.GEMINI_API_KEY,
    keyStart: process.env.GEMINI_API_KEY?.slice(0,8) || 'MISSING'
  });
});

// ── Gemini AI Proxy ───────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

function toGeminiContents(messages, system) {
  const contents = [];
  if (system) {
    contents.push({ role: 'user', parts: [{ text: `[System]: ${system}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  for (const m of messages.slice(-20)) {
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }
  return contents;
}

app.post('/api/chat', aiLimiter, async (req, res) => {
  const { messages, system } = req.body;
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array is required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured.' });

  try {
    const upstream = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: toGeminiContents(messages, system) }),
    });
    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: 'Gemini API error', detail: err });
    }
    const data = await upstream.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.json({ text });
  } catch (err) {
    console.error('Chat proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// ── Gemini quick-call (single prompt) ────────────────────────────────────────
app.post('/api/complete', aiLimiter, async (req, res) => {
  const { prompt, system = 'You are a helpful productivity assistant.' } = req.body;

  if (!prompt || typeof prompt !== 'string')
    return res.status(400).json({ error: 'prompt string is required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured.' });

  try {
    const upstream = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `[System]: ${system}` }] },
          { role: 'model', parts: [{ text: 'Understood.' }] },
          { role: 'user', parts: [{ text: prompt }] },
        ],
      }),
    });
    if (!upstream.ok) throw new Error(`Gemini ${upstream.status}`);
    const data = await upstream.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.json({ text });
  } catch (err) {
    console.error('Complete proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Export data (simple analytics endpoint) ───────────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({ name: 'NexOS', version: require('./package.json').version });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   NexOS AI Productivity OS — v2.0     ║
║   Server running on port ${PORT}          ║
║   http://localhost:${PORT}               ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
