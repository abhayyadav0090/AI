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
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');

const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // needed on Render for rate limiting and secure cookies

// ── Security & middleware ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "fonts.googleapis.com", "https://accounts.google.com"],
      frameSrc: ["https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://cdn.jsdelivr.net", "https://accounts.google.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
    },
  },
}));

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT'],
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

// ── MongoDB ───────────────────────────────────────────────────────────────────
// Connection is cached so it works on Render (long running) and Vercel (serverless).
let dbPromise = null;
function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!dbPromise) {
    dbPromise = mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      .then(() => console.log('MongoDB connected'))
      .catch(err => { dbPromise = null; throw err; });
  }
  return dbPromise;
}
// Only API routes that touch the database need it
app.use(['/api/auth', '/api/me', '/api/state'], async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) {
    console.error('MongoDB connection failed:', err.message);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

const User = mongoose.model('User', new mongoose.Schema({
  googleId: { type: String, unique: true, index: true },
  email: String,
  name: String,
  picture: String,
}, { timestamps: true }));

// Your whole app state (tasks, habits, notes, timer log...) is saved as one
// document per user. This matches how app.js already works.
const UserState = mongoose.model('UserState', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false }));

// ── Google login ──────────────────────────────────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const isProd = process.env.NODE_ENV === 'production';

function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).json({ error: 'Not logged in' });
  }
}

// Frontend needs the client id, so it is not hard-coded in index.html
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'credential required' });

    // Google confirms the token is genuine and was issued for this app
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(401).json({ error: 'Email not verified' });

    const user = await User.findOneAndUpdate(
      { googleId: p.sub },
      { email: p.email, name: p.name, picture: p.picture },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ name: user.name, email: user.email, picture: user.picture });
  } catch (err) {
    console.error('Google login failed:', err.message);
    res.status(401).json({ error: 'Google login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('name email picture');
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

// ── User data (replaces localStorage) ─────────────────────────────────────────
app.get('/api/state', requireAuth, async (req, res) => {
  const doc = await UserState.findOne({ userId: req.userId });
  res.json({ state: doc ? doc.data : null });
});

app.put('/api/state', requireAuth, async (req, res) => {
  const { state } = req.body;
  if (!state || typeof state !== 'object')
    return res.status(400).json({ error: 'state object required' });
  await UserState.findOneAndUpdate(
    { userId: req.userId },
    { data: state },
    { upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true });
});

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

app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
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
app.post('/api/complete', requireAuth, aiLimiter, async (req, res) => {
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
// On Vercel the app is exported and run as a serverless function.
// On Render / locally (node server.js) it listens on a port.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NexOS running on port ${PORT}`);
  });
}

module.exports = app;
