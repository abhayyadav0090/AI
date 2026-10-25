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
const fs         = require('node:fs');
const crypto     = require('node:crypto');
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
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "https://accounts.google.com"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameSrc: ["https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://cdn.jsdelivr.net", "https://accounts.google.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
    },
  },
}));

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
// A browser sends an Origin header on same-site POST/PUT/DELETE and font requests too.
// Requests from the app's own host are therefore always allowed, even if ALLOWED_ORIGINS
// is missing or has a typo; only foreign origins are checked against the list.
function isAllowedOrigin(req, origin) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
  try {
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
    return !!host && new URL(origin).host.toLowerCase() === host;
  } catch (_) { return false; }
}
app.use('/api', (req, res, next) => {
  if (isAllowedOrigin(req, req.headers.origin)) return next();
  res.status(403).json({ error: 'This origin is not allowed to use the NexOS API.', code: 'ORIGIN_NOT_ALLOWED' });
});
app.use((req, res, next) => cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(req, origin)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
})(req, res, next));

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
// Optional exact-path legacy redirects are configured externally as JSON, so this server
// contains no application-specific redirect or cross-app business logic.
app.use((req, res, next) => {
  let redirects = {};
  try { redirects = JSON.parse(process.env.LEGACY_REDIRECTS_JSON || '{}'); } catch (_) {}
  const target = redirects[req.path];
  if (typeof target === 'string' && /^https:\/\//i.test(target)) return res.redirect(302, target);
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res, file) => {
    // Code and pages revalidate on every load (cheap 304s); images and icons can be cached.
    res.setHeader('Cache-Control', /\.(png|svg|ico|webp|woff2?)$/i.test(file) ? 'public, max-age=604800' : 'no-cache');
  },
}));

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

const DB_ROUTES = ['/auth', '/me', '/state', '/push', '/chat', '/chats', '/complete'];
app.use('/api', async (req, res, next) => {
  const p = req.path;
  if (p === '/auth/logout' || p === '/push/config') return next();
  if (!DB_ROUTES.some((r) => p === r || p.startsWith(r + '/'))) return next();
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
  nameCustom: { type: Boolean, default: false }, // true once the user picked their own display name
  picture: String,
  // Sign-in cookies issued before this moment are rejected (set when the user deletes their NexOS data).
  sessionsValidAfter: Date,
}, { timestamps: true }));

const UserState = mongoose.model('UserState', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false }));

// Web Push subscriptions for NexOS task alerts.
const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  endpoint: { type: String, unique: true, index: true, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  app: { type: String, enum: ['nexos'], default: 'nexos', index: true },
  sentKeys: { type: [String], default: [] },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true, minimize: false });
// Define compound indexes on the Mongoose schema before creating the model.
pushSubscriptionSchema.index({ userId: 1, updatedAt: -1 });
const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

// Daily task reminder time is stored separately from task data so normal state syncs
// and backup imports cannot overwrite the user's notification preference.
const PushPreference = mongoose.model('PushPreference', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true, required: true },
  reminderTime: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  enabled: { type: Boolean, default: true },
  timeZone: { type: String, default: 'Asia/Kolkata' },
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

// Checks the login cookie, that the account still exists, and that the cookie was not issued before the
// user deleted their data, so an old cookie on another device cannot bring deleted data back.
async function requireAuth(req, res, next) {
  let id, issuedAt;
  try {
    const payload = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    id = payload.id; issuedAt = (payload.iat || 0) * 1000;
  } catch {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const user = await User.findById(id).select('sessionsValidAfter').lean();
    if (!user || (user.sessionsValidAfter && issuedAt < user.sessionsValidAfter.getTime())) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Not logged in' });
    }
  } catch (err) {
    console.error('Auth check failed:', err.message);
    return res.status(503).json({ error: 'Database unavailable' });
  }
  req.userId = id;
  next();
}

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'credential required' });
    if (!process.env.JWT_SECRET) {
      console.error('Sign-in blocked: JWT_SECRET is not set.');
      return res.status(500).json({ error: 'Sign-in is not set up on the server.', code: 'AUTH_CONFIG' });
    }
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(401).json({ error: 'Email not verified' });
    let user = await User.findOne({ googleId: p.sub });
    if (!user) user = new User({ googleId: p.sub });
    user.email = p.email;
    user.picture = p.picture;
    if (!user.nameCustom) user.name = p.name; // a name the user chose is never overwritten by Google's
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: isProd || req.secure, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ name: user.name, email: user.email, picture: user.picture });
  } catch (err) {
    console.warn('Google sign-in failed:', err.message);
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

// Profile: change the display name
app.put('/api/me', requireAuth, wrap(async (req, res) => {
  const raw = req.body && req.body.name;
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (!name) return res.status(400).json({ error: 'Please enter a name.' });
  if (name.length > 60) return res.status(400).json({ error: 'Use 60 characters or fewer.' });
  const user = await User.findByIdAndUpdate(
    req.userId,
    { name, nameCustom: true },
    { new: true }
  ).select('name email picture');
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ name: user.name, email: user.email, picture: user.picture });
}));

// Profile: delete the account and everything stored for it
app.delete('/api/me', requireAuth, wrap(async (req, res) => {
  if (!req.body || req.body.confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmation required.' });
  }
  await Chat.deleteMany({ userId: req.userId });
  await UserState.deleteMany({ userId: req.userId });
  await PushSubscription.deleteMany({ userId: req.userId, app: 'nexos' });
  await PushPreference.deleteOne({ userId: req.userId });
  // Keep the shared Google identity record (other independently deployed apps may use it), but sign out
  // every device so none of them can write the deleted data back.
  await User.updateOne({ _id: req.userId }, { sessionsValidAfter: new Date() });
  res.clearCookie('token');
  res.json({ ok: true });
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

// ───────────────────────── Shared Web Push / NexOS task reminders ─────────────────────────
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
const b64url = (value) => Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function fromB64url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
}
function vapidPrivateKeyObject() {
  let raw = fromB64url(VAPID_PRIVATE_KEY);
  // A key whose first byte is zero can be stored one byte short; restore the padding.
  if (raw.length >= 30 && raw.length < 32) raw = Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
  if (raw.length !== 32) throw new Error('VAPID_PRIVATE_KEY must decode to 32 bytes.');
  // RFC 5915 ECPrivateKey wrapper using the prime256v1 curve OID.
  const der = Buffer.concat([
    Buffer.from('30310201010420', 'hex'), raw,
    Buffer.from('a00a06082a8648ce3d030107', 'hex'),
  ]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'sec1' });
}
function makeVapidAuthorization(endpoint) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: origin, exp: now + 12 * 60 * 60, sub: VAPID_SUBJECT }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKeyObject(), dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${VAPID_PUBLIC_KEY}`;
}
function encryptPushPayload(subscription, payloadText) {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Invalid Push subscription keys.');

  // RFC 8291: derive the input key material from the subscriber's P-256 public key.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(null, 'uncompressed');
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, info, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // A final-record delimiter (0x02) is required by aes128gcm content coding.
  const plaintext = Buffer.concat([Buffer.from(payloadText, 'utf8'), Buffer.from([0x02])]);
  if (plaintext.length > 3993) throw new Error('Web Push payload is too large.');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ciphertext, tag]);
}
const knownPushHost = (hostname) => {
  const h = String(hostname || '').toLowerCase();
  return h === 'fcm.googleapis.com'
    || h.endsWith('.push.services.mozilla.com')
    || h === 'push.services.mozilla.com'
    || h.endsWith('.notify.windows.com')
    || h === 'web.push.apple.com'
    || h.endsWith('.push.apple.com');
};
async function sendWebPush(subscription, payload) {
  if (!pushConfigured()) throw new Error('Web Push VAPID keys are not configured.');
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:' || !knownPushHost(endpoint.hostname)) {
    throw new Error('Unsupported Push service endpoint.');
  }
  const body = encryptPushPayload(subscription, JSON.stringify(payload));
  const response = await fetch(endpoint.href, {
    method: 'POST',
    headers: {
      Authorization: makeVapidAuthorization(endpoint.href),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404 || response.status === 410) return { expired: true };
  if (!response.ok) {
    const err = new Error(`Push service returned HTTP ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return { ok: true };
}
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}
function zonedDateKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function zonedTimeKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).reduce((out, part) => { if (part.type !== 'literal') out[part.type] = part.value; return out; }, {});
  return `${parts.hour}:${parts.minute}`;
}
function taskDueKey(dateKey, taskId) { return `${dateKey}:${String(taskId)}`; }

app.get('/api/push/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: pushConfigured(), publicKey: pushConfigured() ? VAPID_PUBLIC_KEY : '' });
});

app.get('/api/push/preferences', requireAuth, wrap(async (req, res) => {
  const preference = await PushPreference.findOne({ userId: req.userId }).lean();
  res.set('Cache-Control', 'no-store');
  res.json({ reminderTime: preference?.reminderTime || '09:00', enabled: preference?.enabled !== false, timeZone: preference?.timeZone || DEFAULT_TIME_ZONE });
}));

app.put('/api/push/preferences', requireAuth, wrap(async (req, res) => {
  const updates = {};
  if (req.body?.reminderTime !== undefined) {
    const reminderTime = String(req.body.reminderTime || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
      return res.status(400).json({ error: 'Reminder time must be a valid 24-hour time (HH:MM).' });
    }
    updates.reminderTime = reminderTime;
  }
  if (req.body?.enabled !== undefined) {
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'Reminder enabled must be true or false.' });
    updates.enabled = req.body.enabled;
  }
  if (req.body?.timeZone !== undefined) {
    if (!validTimeZone(req.body.timeZone)) return res.status(400).json({ error: 'Unknown time zone.' });
    updates.timeZone = req.body.timeZone;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide a reminder time or enabled setting.' });
  const preference = await PushPreference.findOneAndUpdate({ userId: req.userId }, { $set: updates }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  res.json({ ok: true, reminderTime: preference.reminderTime || '09:00', enabled: preference.enabled !== false, timeZone: preference.timeZone || DEFAULT_TIME_ZONE });
}));

app.post('/api/push/subscribe', requireAuth, wrap(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Background task alerts are not configured on the server yet.', code: 'PUSH_NOT_CONFIGURED' });
  const sub = req.body && req.body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
    return res.status(400).json({ error: 'A valid browser push subscription is required.' });
  }
  let endpoint;
  try { endpoint = new URL(sub.endpoint); } catch { return res.status(400).json({ error: 'Invalid push endpoint.' }); }
  if (endpoint.protocol !== 'https:' || !knownPushHost(endpoint.hostname)) {
    return res.status(400).json({ error: 'Unsupported push service endpoint.' });
  }
  if (fromB64url(sub.keys.p256dh).length !== 65 || fromB64url(sub.keys.auth).length < 16) {
    return res.status(400).json({ error: 'Invalid push subscription keys.' });
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint: endpoint.href },
    { $set: { userId: req.userId, endpoint: endpoint.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, app: 'nexos', lastSeenAt: new Date() } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true });
}));

app.delete('/api/push/subscribe', requireAuth, wrap(async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Subscription endpoint required.' });
  await PushSubscription.deleteOne({ userId: req.userId, endpoint, app: 'nexos' });
  res.json({ ok: true });
}));

app.post('/api/push/test', requireAuth, wrap(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Background task alerts are not configured on the server yet.', code: 'PUSH_NOT_CONFIGURED' });
  const subscriptions = await PushSubscription.find({ userId: req.userId, app: 'nexos' });
  if (!subscriptions.length) return res.status(404).json({ error: 'No push subscription found. Enable task alerts again from the app.' });
  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      const result = await sendWebPush(subscription, {
        title: 'NexOS task alerts are enabled',
        body: 'This test confirms that this device can receive your NexOS task notifications.',
        url: '/', tag: 'nexos-push-test', kind: 'test',
      });
      if (result.expired) await PushSubscription.deleteOne({ _id: subscription._id });
      else delivered += 1;
    } catch (err) { console.warn('Push test failed:', err.message); }
  }
  if (!delivered) return res.status(502).json({ error: 'The push service rejected the test notification. Check the server logs and VAPID settings.' });
  res.json({ ok: true, delivered });
}));

let pushSweepRunning = false;
async function checkAndSendDueTaskPushes() {
  if (!pushConfigured() || mongoose.connection.readyState !== 1 || pushSweepRunning) return;
  pushSweepRunning = true;
  try {
    const userIds = await PushSubscription.distinct('userId', { app: 'nexos' });
    if (!userIds.length) return;
    const prefs = new Map((await PushPreference.find({ userId: { $in: userIds } }).lean()).map((p) => [String(p.userId), p]));
    const states = await UserState.find({ userId: { $in: userIds } }).select('userId data.tasks').lean();
    const now = new Date();
    for (const item of states) {
      const preference = prefs.get(String(item.userId));
      if (preference?.enabled === false) continue;
      const reminderTime = preference?.reminderTime || '09:00';
      const timeZone = validTimeZone(preference?.timeZone) ? preference.timeZone : DEFAULT_TIME_ZONE;
      const todayKey = zonedDateKey(now, timeZone);
      if (zonedTimeKey(now, timeZone) < reminderTime) continue;
      const tasks = Array.isArray(item.data && item.data.tasks) ? item.data.tasks : [];
      const due = tasks.filter((task) => task && task.id != null && task.col !== 'done'
        && typeof task.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.due) && task.due <= todayKey)
        .sort((a, b) => String(a.due).localeCompare(String(b.due)));
      if (!due.length) continue;
      const subscriptions = await PushSubscription.find({ userId: item.userId, app: 'nexos' });
      for (const subscription of subscriptions) {
        let changed = false;
        let expired = false;
        // Keep dedupe storage bounded: only retain keys for today and yesterday.
        const cutoff = new Date(Date.now() - 2 * 86400000);
        const minKeyDate = zonedDateKey(cutoff, timeZone);
        const oldSentKeys = Array.isArray(subscription.sentKeys) ? subscription.sentKeys : [];
        const retained = oldSentKeys.filter((key) => typeof key === 'string' && key.slice(0, 10) >= minKeyDate);
        if (retained.length !== oldSentKeys.length) { subscription.sentKeys = retained; changed = true; }
        const pendingDue = due.filter((task) => !subscription.sentKeys.includes(taskDueKey(todayKey, task.id))).slice(0, 3);
        for (const task of pendingDue) {
          const sentKey = taskDueKey(todayKey, task.id);
          const isOverdue = task.due < todayKey;
          try {
            const result = await sendWebPush(subscription, {
              title: isOverdue ? 'NexOS task overdue' : 'NexOS task due today',
              body: String(task.title || 'Untitled task').slice(0, 160),
              url: '/', tag: `nexos-task-${String(task.id).slice(0, 80)}`, kind: 'task', taskId: String(task.id),
            });
            if (result.expired) {
              await PushSubscription.deleteOne({ _id: subscription._id });
              expired = true;
              break;
            }
            subscription.sentKeys.push(sentKey);
            changed = true;
          } catch (err) {
            // Keep the key unsent so a transient push-service outage can retry next poll.
            console.warn(`Task push failed for ${subscription.userId}:`, err.message);
          }
        }
        if (changed && !expired) {
          subscription.lastSeenAt = new Date();
          await subscription.save();
        }
      }
    }
  } finally {
    pushSweepRunning = false;
  }
}

function startTaskPushScheduler() {
  if (!pushConfigured()) {
    console.log('Web Push disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable background reminders.');
    return;
  }
  const run = async () => {
    try {
      if (mongoose.connection.readyState !== 1) await connectDB();
      await checkAndSendDueTaskPushes();
    } catch (err) {
      console.warn('Task push scheduler error:', err.message);
    }
  };
  setTimeout(run, 5000);
  setInterval(run, 5 * 60 * 1000);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'idle', timestamp: new Date().toISOString(), version: require('./package.json').version });
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
      if (!chat) return res.status(404).json({ error: 'Chat not found.', code: 'CHAT_NOT_FOUND' });
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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// Two experiences share one account and one set of data: Classic (the default) and Enterprise.
app.get(['/classic', '/classic/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(['/enterprise', '/enterprise/', '/redesign', '/redesign/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-redesign.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Last resort: always answer with JSON, never an HTML stack page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.', code: 'BAD_REQUEST' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.', code: 'TOO_LARGE' });
  console.error('Unhandled error:', err && err.message);
  res.status(500).json({ error: 'Something went wrong.', code: 'SERVER_ERROR' });
});

function reportConfig() {
  const missing = [
    ['MONGO_URI', process.env.MONGO_URI], ['JWT_SECRET', process.env.JWT_SECRET],
    ['GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID], ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`Config warning: missing ${missing.join(', ')}. Related features will not work until they are set.`);
  if (!process.env.ALLOWED_ORIGINS) console.warn('Config note: ALLOWED_ORIGINS is not set. Requests from the app\'s own host still work.');
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NexOS running on port ${PORT}`);
    reportConfig();
    startTaskPushScheduler();
  });
}

module.exports = app;
