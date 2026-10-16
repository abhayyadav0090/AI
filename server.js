/**
 * NexOS — Backend Server
 * Express.js API proxy for Google Gemini + static file serving
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
app.set('trust proxy', 1);

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

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.', code: 'RATE_LIMIT' },
});

const userKey = (req) => String(req.userId || 'anon');
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending messages too fast. Please wait a few seconds.', code: 'RATE_LIMIT' },
});
const aiDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 500,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You've reached today's AI limit. Please try again tomorrow.", code: 'DAILY_LIMIT' },
});

app.use('/api', globalLimiter);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

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

const UserState = mongoose.model('UserState', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false }));

const MAX_MSG_CHARS = 4000;
const MAX_CHAT_MESSAGES = 200;
const CONTEXT_MESSAGES = 40;
const MAX_CHATS = 100;

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

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const isProd = process.env.NODE_ENV === 'production';
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

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'credential required' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(401).json({ error: 'Email not verified' });
    const user = await User.findOneAndUpdate(
      { googleId: p.sub },
      { email: p.email, name: p.name, picture: p.picture },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ name: user.name, email: user.email, picture: user.picture });
  } catch (err) {
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

app.get('/api/state', requireAuth, wrap(async (req, res) => {
  const doc = await UserState.findOne({ userId: req.userId });
  res.json({ state: doc ? doc.data : null });
}));

app.put('/api/state', requireAuth, wrap(async (req, res) => {
  const { state } = req.body;
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'state object required' });
  await UserState.findOneAndUpdate({ userId: req.userId }, { data: state }, { upsert: true, setDefaultsOnInsert: true });
  res.json({ ok: true });
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: require('./package.json').version });
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';
const geminiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

class AIError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function aiErrorFor(upstreamStatus) {
  if (upstreamStatus === 429) return new AIError(503, 'AI_BUSY', 'NexAI is busy right now. Please wait a moment and try again.');
  return new AIError(502, 'AI_ERROR', 'NexAI could not answer right now. Please try again.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askGemini({ system, contents }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIError(500, 'AI_CONFIG', 'The AI service is not set up correctly.');
  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean);
  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let upstream;
      try {
        upstream = await fetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (err) {
        await sleep(1000); continue;
      }
      if (upstream.ok) {
        const data = await upstream.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        return text || "I couldn't produce an answer for that.";
      }
      lastStatus = upstream.status;
      if (![429, 500, 502, 503, 504].includes(upstream.status)) break;
      await sleep(1500);
    }
  }
  throw aiErrorFor(lastStatus);
}

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

function sendAIError(err, res) {
  if (err instanceof AIError) return res.status(err.status).json({ error: err.message, code: err.code });
  return res.status(500).json({ error: 'Something went wrong.', code: 'SERVER_ERROR' });
}

async function pruneOldChats(userId) {
  const extra = await Chat.find({ userId }).sort({ updatedAt: -1 }).skip(MAX_CHATS).select('_id').lean();
  if (extra.length) await Chat.deleteMany({ _id: { $in: extra.map((c) => c._id) } });
}

app.post('/api/chat', requireAuth, aiLimiter, aiDailyLimiter, async (req, res) => {
  try {
    const { chatId, message, system } = req.body || {};
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return res.status(400).json({ error: 'Type a message first.', code: 'BAD_REQUEST' });
    if (text.length > MAX_MSG_CHARS) {
      return res.status(413).json({ error: `Messages must be ${MAX_MSG_CHARS} characters or fewer.`, code: 'MESSAGE_TOO_LONG' });
    }
    let chat;
    if (chatId) {
      if (!mongoose.isValidObjectId(chatId)) return res.status(400).json({ error: 'Invalid chat.' });
      chat = await Chat.findOne({ _id: chatId, userId: req.userId });
      if (!chat) return res.status(404).json({ error: 'Chat not found.' });
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
    // Bound persisted history. The most recent 200 messages are enough for UI history;
    // only the latest CONTEXT_MESSAGES are sent to Gemini for each request.
    while (chat.messages.length > MAX_CHAT_MESSAGES) chat.messages.shift();
    await chat.save();
    pruneOldChats(req.userId).catch(() => {});
    res.json({ text: reply, chatId: chat._id, title: chat.title, updatedAt: chat.updatedAt });
  } catch (err) {
    sendAIError(err, res);
  }
});

app.get('/api/chats', requireAuth, wrap(async (req, res) => {
  const chats = await Chat.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(MAX_CHATS).select('title updatedAt').lean();
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

app.post('/api/complete', requireAuth, aiLimiter, aiDailyLimiter, async (req, res) => {
  const { prompt, system } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt required' });
  try {
    const text = await askGemini({
      system: typeof system === 'string' ? system.slice(0, 6000) : 'You are a helpful productivity assistant.',
      contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 12000) }] }],
    });
    res.json({ text });
  } catch (err) {
    sendAIError(err, res);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`NexOS running on port ${PORT}`));
}

module.exports = app;