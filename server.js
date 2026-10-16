/**
 * NexOS — Backend Server
 * Express.js API proxy for Google Gemini + static file serving
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
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max: 600,                   // per IP, API calls only (static files are not counted)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.', code: 'RATE_LIMIT' },
});

// AI limits are per signed-in user (not per IP), so many testers on one
// Wi-Fi network do not block each other.
const userKey = (req) => String(req.userId || 'anon');
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 min
  max: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending messages too fast. Please wait a few seconds.', code: 'RATE_LIMIT' },
});
const aiDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 1 day
  max: 500,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You've reached today's AI limit. Please try again tomorrow.", code: 'DAILY_LIMIT' },
});

app.use('/api', globalLimiter);

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
app.use(['/api/auth', '/api/me', '/api/state', '/api/chat', '/api/chats'], async (req, res, next) => {
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

// Saved AI conversations (one document per chat, owned by one user).
const MAX_MSG_CHARS = 4000;      // longest single message a user can send
const MAX_CHAT_MESSAGES = 200;   // messages kept in one chat
const CONTEXT_MESSAGES = 40;     // how many recent messages the AI sees
const MAX_CHATS = 100;           // saved chats per user (oldest are removed)

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New chat' },
  messages: [{
    _id: false,
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    ts: Number,
  }],
}, { timestamps: true });
chatSchema.index({ userId: 1, updatedAt: -1 });
const Chat = mongoose.model('Chat', chatSchema);

// ── Google login ──────────────────────────────────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const isProd = process.env.NODE_ENV === 'production';

// Express 4 does not catch errors from async handlers, so wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const user = await User.findById(req.userId).select('name email picture');
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
}));

// ── User data (replaces localStorage) ─────────────────────────────────────────
app.get('/api/state', requireAuth, wrap(async (req, res) => {
  const doc = await UserState.findOne({ userId: req.userId });
  res.json({ state: doc ? doc.data : null });
}));

app.put('/api/state', requireAuth, wrap(async (req, res) => {
  const { state } = req.body;
  if (!state || typeof state !== 'object')
    return res.status(400).json({ error: 'state object required' });
  await UserState.findOneAndUpdate(
    { userId: req.userId },
    { data: state },
    { upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true });
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

// ------------------------------ Gemini AI ------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
// Optional: a second model to try when the first one is busy or over quota.
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';
const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

class AIError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function aiErrorFor(upstreamStatus) {
  if (upstreamStatus === 429) {
    return new AIError(503, 'AI_BUSY', 'NexAI is busy right now (the AI service is at its free limit). Please wait about 30 seconds and try again.');
  }
  if (upstreamStatus === 400 || upstreamStatus === 401 || upstreamStatus === 403) {
    return new AIError(500, 'AI_CONFIG', 'The AI service is not set up correctly. Please tell the site owner.');
  }
  return new AIError(502, 'AI_ERROR', 'NexAI could not answer right now. Please try again in a moment.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls Gemini. Retries once on temporary errors, then tries the fallback model if one is set.
async function askGemini({ system, contents }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIError(500, 'AI_CONFIG', 'The AI service is not set up correctly. Please tell the site owner.');

  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean);
  let lastStatus = 0;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let upstream;
      try {
        upstream = await fetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (err) {
        lastStatus = 0;
        console.error(`Gemini ${model} network error:`, err.message);
        await sleep(1000);
        continue;
      }

      if (upstream.ok) {
        const data = await upstream.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        return text || "I couldn't produce an answer for that. Please try rephrasing your question.";
      }

      lastStatus = upstream.status;
      const detail = await upstream.text().catch(() => '');
      console.error(`Gemini ${model} returned ${upstream.status}:`, detail.slice(0, 300));
      if (![429, 500, 502, 503, 504].includes(upstream.status)) break; // not worth retrying
      await sleep(1500);
    }
  }
  throw aiErrorFor(lastStatus);
}

// Turns saved chat messages into Gemini's format. Gemini needs roles to alternate
// and the conversation to start with the user, so merge repeats and drop a leading model turn.
function toGeminiContents(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const text = String(m.content || '').trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + text;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function makeTitle(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 50 ? t.slice(0, 50).trim() + '...' : t;
}

function sendAIError(err, res, label) {
  if (err instanceof AIError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(label + ' error:', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
}

async function pruneOldChats(userId) {
  const extra = await Chat.find({ userId }).sort({ updatedAt: -1 }).skip(MAX_CHATS).select('_id').lean();
  if (extra.length) await Chat.deleteMany({ _id: { $in: extra.map((c) => c._id) } });
}

// ------------------------------ Chat history ------------------------------
// Send a message. The server saves both your message and the AI reply, so
// chats survive refreshes, new devices and logins. Nothing is saved if the AI call fails.
app.post('/api/chat', requireAuth, aiLimiter, aiDailyLimiter, async (req, res) => {
  try {
    const { chatId, message, system } = req.body || {};
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return res.status(400).json({ error: 'Type a message first.', code: 'BAD_REQUEST' });
    if (text.length > MAX_MSG_CHARS) {
      return res.status(400).json({ error: `Message is too long (max ${MAX_MSG_CHARS} characters).`, code: 'TOO_LONG' });
    }

    let chat;
    if (chatId) {
      if (!mongoose.isValidObjectId(chatId)) return res.status(400).json({ error: 'Invalid chat.', code: 'BAD_REQUEST' });
      chat = await Chat.findOne({ _id: chatId, userId: req.userId });
      if (!chat) return res.status(404).json({ error: 'Chat not found. Please start a new chat.', code: 'NOT_FOUND' });
      if (chat.messages.length >= MAX_CHAT_MESSAGES) {
        return res.status(400).json({ error: 'This chat is full. Please start a new chat.', code: 'CHAT_FULL' });
      }
    } else {
      chat = new Chat({ userId: req.userId, title: makeTitle(text), messages: [] });
    }

    const history = chat.messages.slice(-CONTEXT_MESSAGES).map((m) => ({ role: m.role, content: m.content }));
    const reply = await askGemini({
      system: typeof system === 'string' ? system.slice(0, 6000) : '',
      contents: toGeminiContents([...history, { role: 'user', content: text }]),
    });

    chat.messages.push({ role: 'user', content: text, ts: Date.now() });
    chat.messages.push({ role: 'assistant', content: reply.slice(0, 20000), ts: Date.now() });
    await chat.save();
    pruneOldChats(req.userId).catch((e) => console.error('Prune failed:', e.message));

    res.json({ text: reply, chatId: chat._id, title: chat.title, updatedAt: chat.updatedAt });
  } catch (err) {
    sendAIError(err, res, 'Chat');
  }
});

app.get('/api/chats', requireAuth, wrap(async (req, res) => {
  const chats = await Chat.find({ userId: req.userId })
    .sort({ updatedAt: -1 }).limit(MAX_CHATS).select('title updatedAt').lean();
  res.json({ chats: chats.map((c) => ({ id: c._id, title: c.title, updatedAt: c.updatedAt })) });
}));

app.get('/api/chats/:id', requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Chat not found.' });
  const chat = await Chat.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat: { id: chat._id, title: chat.title, updatedAt: chat.updatedAt, messages: chat.messages } });
}));

app.delete('/api/chats/:id', requireAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Chat not found.' });
  await Chat.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
}));

// One-off prompts (daily insight, task descriptions, note summaries). Not saved.
app.post('/api/complete', requireAuth, aiLimiter, aiDailyLimiter, async (req, res) => {
  const { prompt, system } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt string is required', code: 'BAD_REQUEST' });
  }
  try {
    const text = await askGemini({
      system: typeof system === 'string' ? system.slice(0, 6000) : 'You are a helpful productivity assistant.',
      contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 12000) }] }],
    });
    res.json({ text });
  } catch (err) {
    sendAIError(err, res, 'Complete');
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
