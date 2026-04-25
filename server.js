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

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const aiLimiter     = rateLimit({ windowMs: 60 * 1000, max: 20 });
app.use(globalLimiter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) + 's' });
});

app.get('/api/debug', (req, res) => {
  res.json({
    hasKey: !!process.env.GEMINI_API_KEY,
    keyStart: process.env.GEMINI_API_KEY?.slice(0, 8) || 'MISSING',
  });
});

// ── Gemini ────────────────────────────────────────────────────────────────────
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
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  let upstream;
  try {
    upstream = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: toGeminiContents(messages, system) }),
    });
  } catch (err) {
    return res.status(500).json({ error: 'fetch failed', detail: err.message });
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: 'Gemini error', status: upstream.status, detail: raw });
  }

  try {
    const data = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'JSON parse failed', raw });
  }
});

app.post('/api/complete', aiLimiter, async (req, res) => {
  const { prompt, system = 'You are a helpful productivity assistant.' } = req.body;
  if (!prompt || typeof prompt !== 'string')
    return res.status(400).json({ error: 'prompt string is required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  let upstream;
  try {
    upstream = await fetch(GEMINI_URL(apiKey), {
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
  } catch (err) {
    return res.status(500).json({ error: 'fetch failed', detail: err.message });
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: 'Gemini error', status: upstream.status, detail: raw });
  }

  try {
    const data = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'JSON parse failed', raw });
  }
});

app.get('/api/version', (req, res) => {
  res.json({ name: 'NexOS', version: require('./package.json').version });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`NexOS running on port ${PORT}`);
});

module.exports = app;
