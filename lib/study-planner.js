'use strict';
// NexOS 4.5.1 — persistent Study Studio revision queue, exam plans, due-date scheduling,
// Google Calendar / ICS time-block generation, and optional Google Calendar OAuth sync.

const crypto = require('node:crypto');
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function defineModels(mongoose) {
  const { Schema } = mongoose;
  const reviewSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'StudyDocument', default: null },
    topic: { type: String, required: true, maxlength: 120 },
    prompt: { type: String, default: '', maxlength: 500 },
    answer: { type: String, default: '', maxlength: 800 },
    dueAt: { type: Date, default: Date.now, index: true },
    intervalDays: { type: Number, default: 0 },
    repetitions: { type: Number, default: 0 },
    ease: { type: Number, default: 2.5 },
    lastReviewedAt: { type: Date, default: null },
    lastRating: { type: String, enum: ['again', 'hard', 'good'], default: null },
    sourcePage: { type: Number, default: null },
  }, { timestamps: true });
  reviewSchema.index({ userId: 1, dueAt: 1 });
  reviewSchema.index({ userId: 1, topic: 1, documentId: 1 });

  const planSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 100 },
    subject: { type: String, default: '', maxlength: 60 },
    examDate: { type: Date, required: true },
    dailyMinutes: { type: Number, default: 60, min: 10, max: 600 },
    studyTime: { type: String, default: '18:00', match: TIME_HHMM },
    timeZone: { type: String, default: DEFAULT_TIME_ZONE, maxlength: 80 },
    topics: [{ type: String, maxlength: 120 }],
    completedTopics: [{ type: String, maxlength: 120 }],
  }, { timestamps: true });
  planSchema.index({ userId: 1, examDate: 1 });

  const calendarConnectionSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    refreshToken: { type: String, required: true },
    scope: { type: String, default: '' },
  }, { timestamps: true });

  return {
    StudyReview: mongoose.models.StudyReview || mongoose.model('StudyReview', reviewSchema),
    StudyExamPlan: mongoose.models.StudyExamPlan || mongoose.model('StudyExamPlan', planSchema),
    StudyCalendarConnection: mongoose.models.StudyCalendarConnection || mongoose.model('StudyCalendarConnection', calendarConnectionSchema),
  };
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nextReview(interval, rating, repetitions) {
  if (rating === 'again') return { intervalDays: 1, repetitions: 0 };
  if (rating === 'hard') return { intervalDays: Math.max(2, Math.min(3, interval || 1)), repetitions: repetitions + 1 };
  const steps = [1, 3, 7, 14, 30];
  return { intervalDays: steps[Math.min(repetitions, steps.length - 1)], repetitions: repetitions + 1 };
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}

function zonedDateKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const tz = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToKey(dateKey, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Math.round(Number(days) || 0)));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function daysBetweenKeys(startKey, endKey) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startKey || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endKey || ''));
  if (!a || !b) return 0;
  const msA = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const msB = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round((msB - msA) / 86400000);
}

/* Converts YYYY-MM-DD + HH:MM in `timeZone` to the corresponding UTC Date, preserving wall-clock time across DST transitions. */
function localDateTimeInZoneUtc(dateKey, hhmm = '00:00', timeZone = DEFAULT_TIME_ZONE) {
  const tz = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return new Date();
  const [hh, mm] = normalizeTimeHHMM(hhmm, '00:00').split(':').map(Number);
  const targetAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm, 0);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const zoneOffsetAt = (utcMs) => {
    const parts = fmt.formatToParts(new Date(utcMs)).reduce((out, p) => {
      if (p.type !== 'literal') out[p.type] = p.value;
      return out;
    }, {});
    const zonedAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return zonedAsUtc - utcMs;
  };
  let candidate = targetAsUtc - zoneOffsetAt(targetAsUtc);
  // One refinement pass settles DST transitions cleanly.
  candidate = targetAsUtc - zoneOffsetAt(candidate);
  return new Date(candidate);
}

/* Converts YYYY-MM-DD 00:00 in `timeZone` to a UTC Date so due reviews become active at the start of the target day. */
function localStartOfDayUtc(dateKey, timeZone = DEFAULT_TIME_ZONE) {
  return localDateTimeInZoneUtc(dateKey, '00:00', timeZone);
}

function computeNextDueAt(now = new Date(), intervalDays = 1, timeZone = DEFAULT_TIME_ZONE) {
  const tz = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const todayKey = zonedDateKey(now, tz);
  const targetKey = addDaysToKey(todayKey, Math.max(1, Math.round(Number(intervalDays) || 1)));
  return localStartOfDayUtc(targetKey, tz);
}

function normalizeTimeHHMM(value, fallback = '18:00') {
  const s = String(value || '').trim();
  return TIME_HHMM.test(s) ? s : fallback;
}

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = normalizeTimeHHMM(hhmm).split(':').map(Number);
  const total = Math.min(23 * 60 + 55, Math.max(h * 60 + m + 5, h * 60 + m + Math.round(Number(minutes) || 60)));
  const eh = String(Math.floor(total / 60)).padStart(2, '0');
  const em = String(total % 60).padStart(2, '0');
  return `${eh}:${em}`;
}

function scheduleExamTimeBlocks(plan, opts = {}) {
  if (!plan || !plan.examDate) return [];
  const tz = validTimeZone(opts.timeZone) ? opts.timeZone : DEFAULT_TIME_ZONE;
  const startKey = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.startDateKey || ''))
    ? opts.startDateKey
    : zonedDateKey(new Date(), tz);
  const examKey = zonedDateKey(new Date(plan.examDate), tz);
  const startTime = normalizeTimeHHMM(opts.startTime, '18:00');
  const dailyMinutes = Math.max(10, Math.min(600, Math.round(Number(plan.dailyMinutes) || 60)));
  const endTime = addMinutesToTime(startTime, dailyMinutes);
  const maxBlocks = Math.max(1, Math.min(90, Number(opts.maxBlocks) || 60));

  const allTopics = Array.isArray(plan.topics) ? plan.topics.filter(Boolean) : [];
  const doneSet = new Set(Array.isArray(plan.completedTopics) ? plan.completedTopics : []);
  const remaining = allTopics.filter((t) => !doneSet.has(t));
  const pool = remaining.length ? remaining : allTopics;
  if (!pool.length) return [];

  // Schedule from startKey up to the day before examKey (or startKey itself if exam is today/tomorrow).
  const rawGap = daysBetweenKeys(startKey, examKey);
  const studyDays = Math.min(maxBlocks, Math.max(1, rawGap > 1 ? rawGap : 1));
  const buckets = Array.from({ length: studyDays }, () => []);
  pool.forEach((topic, idx) => {
    buckets[idx % studyDays].push(topic);
  });

  const blocks = [];
  for (let i = 0; i < studyDays; i++) {
    const dayTopics = buckets[i];
    if (!dayTopics.length) continue;
    const date = addDaysToKey(startKey, i);
    const subjectPart = plan.subject ? ` (${plan.subject})` : '';
    const title = `Revise: ${plan.title}${subjectPart}`;
    const description = [
      `NexOS Study Studio revision block (${dailyMinutes} min)`,
      `Exam: ${plan.title}${subjectPart} · Exam date: ${examKey}`,
      'Topics:',
      ...dayTopics.map((t) => `- ${t}`),
    ].join('\n');
    blocks.push({
      date,
      startTime,
      endTime,
      minutes: dailyMinutes,
      title,
      subject: plan.subject || '',
      topics: dayTopics,
      description,
    });
  }
  return blocks;
}

function gcalStamp(dateKey, hhmm) {
  return String(dateKey || '').replace(/-/g, '') + 'T' + String(hhmm || '18:00').replace(/:/g, '') + '00';
}

function buildGoogleCalendarUrl(block, opts = {}) {
  if (!block || !block.date) return '';
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', String(block.title || 'Exam Revision').slice(0, 140));
  params.set('dates', `${gcalStamp(block.date, block.startTime)}/${gcalStamp(block.date, block.endTime)}`);
  if (block.description) params.set('details', String(block.description).slice(0, 1500));
  if (opts.timeZone && validTimeZone(opts.timeZone)) params.set('ctz', opts.timeZone);
  if (opts.recurUntilDateKey && /^\d{4}-\d{2}-\d{2}$/.test(opts.recurUntilDateKey) && opts.recurUntilDateKey > block.date) {
    params.set('recur', `RRULE:FREQ=DAILY;UNTIL=${opts.recurUntilDateKey.replace(/-/g, '')}T235959Z`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeIcsText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line) {
  const s = String(line || '');
  if (s.length <= 75) return s;
  const parts = [s.slice(0, 75)];
  for (let i = 75; i < s.length; i += 74) parts.push(' ' + s.slice(i, i + 74));
  return parts.join('\r\n');
}

function buildExamPlanIcs(plan, opts = {}) {
  const tz = validTimeZone(opts.timeZone) ? opts.timeZone : DEFAULT_TIME_ZONE;
  const blocks = scheduleExamTimeBlocks(plan, { ...opts, timeZone: tz });
  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const planId = cleanText(plan.id || plan._id || 'plan', 40).replace(/\s+/g, '-') || 'plan';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NexOS//Study Studio 4.5.1//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  blocks.forEach((b, idx) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:nexos-study-${planId}-${idx + 1}-${b.date}@nexos.app`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART;TZID=${tz}:${gcalStamp(b.date, b.startTime)}`);
    lines.push(`DTEND;TZID=${tz}:${gcalStamp(b.date, b.endTime)}`);
    lines.push(`SUMMARY:${escapeIcsText(b.title)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(b.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function calendarCryptoKey() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

function encryptRefreshToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', calendarCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptRefreshToken(value) {
  const [ivText, tagText, dataText] = String(value || '').split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Stored Google Calendar connection is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', calendarCryptoKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

function calendarOAuthConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || '';
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

function calendarOAuthClient(config) {
  const { OAuth2Client } = require('google-auth-library');
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

function createRouter({ mongoose, StudyReview: Review, StudyExamPlan: Plan, StudyCalendarConnection: CalendarConnection, PushPreference, requireAuth, isValidId }) {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  router.get('/calendar/status', requireAuth, wrap(async (req, res) => {
    const connected = CalendarConnection ? await CalendarConnection.exists({ userId: req.userId }) : false;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ connected: !!connected, configured: !!calendarOAuthConfig() });
  }));

  router.get('/calendar/connect', requireAuth, wrap(async (req, res) => {
    const config = calendarOAuthConfig();
    if (!config) return res.status(503).json({ error: 'Google Calendar OAuth is not configured on the server.', code: 'CALENDAR_NOT_CONFIGURED' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET is not configured.' });
    const state = jwt.sign({ uid: String(req.userId), purpose: 'nexos-study-calendar' }, process.env.JWT_SECRET, { expiresIn: '10m', issuer: 'nexos' });
    const url = calendarOAuthClient(config).generateAuthUrl({
      access_type: 'offline', prompt: 'consent', include_granted_scopes: true,
      scope: ['https://www.googleapis.com/auth/calendar.events'], state,
    });
    res.json({ url });
  }));

  router.get('/calendar/callback', wrap(async (req, res) => {
    const config = calendarOAuthConfig();
    if (!config || !CalendarConnection) return res.status(503).send('Google Calendar OAuth is not configured.');
    if (req.query.error) return res.redirect('/?study=revision&calendar=cancelled');
    let state;
    try { state = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET, { issuer: 'nexos' }); }
    catch (_) { return res.status(400).send('Invalid or expired Google Calendar authorization state.'); }
    if (state.purpose !== 'nexos-study-calendar' || !mongoose.isValidObjectId(state.uid) || typeof req.query.code !== 'string') {
      return res.status(400).send('Invalid Google Calendar authorization response.');
    }
    const client = calendarOAuthClient(config);
    const { tokens } = await client.getToken(String(req.query.code));
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const old = await CalendarConnection.findOne({ userId: state.uid }).lean();
      if (old) refreshToken = decryptRefreshToken(old.refreshToken);
    }
    if (!refreshToken) return res.status(400).send('Google did not return a refresh token. Reconnect and approve calendar access.');
    await CalendarConnection.findOneAndUpdate(
      { userId: state.uid },
      { $set: { refreshToken: encryptRefreshToken(refreshToken), scope: tokens.scope || '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.redirect('/?study=revision&calendar=connected');
  }));

  router.delete('/calendar/connection', requireAuth, wrap(async (req, res) => {
    if (CalendarConnection) await CalendarConnection.deleteOne({ userId: req.userId });
    res.json({ ok: true });
  }));

  const userTimeZone = async (userId, requestedTz) => {
    if (validTimeZone(requestedTz)) return requestedTz;
    if (PushPreference) {
      const pref = await PushPreference.findOne({ userId }).select('timeZone').lean().catch(() => null);
      if (pref && validTimeZone(pref.timeZone)) return pref.timeZone;
    }
    return DEFAULT_TIME_ZONE;
  };

  router.get('/reviews', requireAuth, wrap(async (req, res) => {
    const now = new Date();
    const items = await Review.find({ userId: req.userId }).sort({ dueAt: 1, updatedAt: -1 }).limit(300).lean();
    const upcoming = items.find((x) => new Date(x.dueAt) > now);
    res.json({
      items: items.map((x) => ({
        id: String(x._id),
        topic: x.topic,
        prompt: x.prompt,
        answer: x.answer,
        dueAt: x.dueAt,
        intervalDays: x.intervalDays,
        repetitions: x.repetitions,
        lastRating: x.lastRating,
        lastReviewedAt: x.lastReviewedAt || null,
        documentId: x.documentId ? String(x.documentId) : null,
        sourcePage: x.sourcePage,
      })),
      due: items.filter((x) => new Date(x.dueAt) <= now).length,
      total: items.length,
      nextDueAt: upcoming ? upcoming.dueAt : null,
    });
  }));

  router.post('/reviews', requireAuth, wrap(async (req, res) => {
    const body = req.body || {};
    const topic = cleanText(body.topic, 120);
    if (topic.length < 2) return res.status(400).json({ error: 'Enter a topic to revise.' });
    let documentId = null;
    if (body.documentId) {
      if (!isValidId(body.documentId)) return res.status(404).json({ error: 'Document not found.' });
      const Doc = mongoose.model('StudyDocument');
      const doc = await Doc.findOne({ _id: body.documentId, userId: req.userId }).select('_id').lean();
      if (!doc) return res.status(404).json({ error: 'Document not found.' });
      documentId = doc._id;
    }
    const prompt = cleanText(body.prompt, 500);
    const answer = cleanText(body.answer, 800);
    const sourcePage = Number.isInteger(body.sourcePage) && body.sourcePage > 0 ? body.sourcePage : null;

    // Deduplicate existing revision item with the same topic and document instead of creating duplicates.
    const existing = await Review.findOne({ userId: req.userId, topic, documentId });
    if (existing) {
      if (prompt) existing.prompt = prompt;
      if (answer) existing.answer = answer;
      if (sourcePage) existing.sourcePage = sourcePage;
      existing.dueAt = new Date();
      existing.intervalDays = 0;
      existing.repetitions = 0;
      existing.lastRating = 'again';
      await existing.save();
      return res.status(201).json({ id: String(existing._id), topic: existing.topic, dueAt: existing.dueAt, updated: true });
    }

    const reviewCount = await Review.countDocuments({ userId: req.userId });
    if (reviewCount >= 500) return res.status(403).json({ error: 'Revision queue is full (500 items). Clear older items to add more.' });
    const item = await Review.create({ userId: req.userId, documentId, topic, prompt, answer, sourcePage, dueAt: new Date() });
    res.status(201).json({ id: String(item._id), topic: item.topic, dueAt: item.dueAt });
  }));

  router.post('/reviews/:id/rate', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Revision item not found.' });
    const rating = String((req.body || {}).rating || '');
    if (!['again', 'hard', 'good'].includes(rating)) return res.status(400).json({ error: 'Choose Again, Hard or Got it.' });
    const item = await Review.findOne({ _id: req.params.id, userId: req.userId });
    if (!item) return res.status(404).json({ error: 'Revision item not found.' });
    const tz = await userTimeZone(req.userId, req.body && req.body.timeZone);
    const now = new Date();
    const schedule = nextReview(item.intervalDays, rating, item.repetitions);
    item.intervalDays = schedule.intervalDays;
    item.repetitions = schedule.repetitions;
    item.lastRating = rating;
    item.lastReviewedAt = now;
    item.dueAt = computeNextDueAt(now, schedule.intervalDays, tz);
    await item.save();
    res.json({
      ok: true,
      dueAt: item.dueAt,
      dueDateKey: zonedDateKey(item.dueAt, tz),
      intervalDays: item.intervalDays,
      repetitions: item.repetitions,
      lastRating: item.lastRating,
    });
  }));

  router.delete('/reviews/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Revision item not found.' });
    const out = await Review.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: out.deletedCount === 1 });
  }));

  router.get('/plans', requireAuth, wrap(async (req, res) => {
    const plans = await Plan.find({ userId: req.userId }).sort({ examDate: 1 }).lean();
    res.json({ plans: plans.map((p) => ({ id: String(p._id), title: p.title, subject: p.subject, examDate: p.examDate, dailyMinutes: p.dailyMinutes, studyTime: p.studyTime || '18:00', timeZone: p.timeZone || DEFAULT_TIME_ZONE, topics: p.topics || [], completedTopics: p.completedTopics || [] })) });
  }));

  router.post('/plans', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const title = cleanText(b.title, 100);
    const timeZone = validTimeZone(b.timeZone) ? b.timeZone : DEFAULT_TIME_ZONE;
    const rawExamDate = typeof b.examDate === 'string' ? b.examDate.trim() : '';
    const examDate = /^\d{4}-\d{2}-\d{2}$/.test(rawExamDate)
      ? localDateTimeInZoneUtc(rawExamDate, '12:00', timeZone)
      : new Date(b.examDate);
    const topics = Array.isArray(b.topics) ? [...new Set(b.topics.map((x) => cleanText(x, 120)).filter((x) => x.length >= 2))].slice(0, 80) : [];
    const dailyMinutes = Math.max(10, Math.min(600, Math.round(Number(b.dailyMinutes) || 60)));
    const studyTime = normalizeTimeHHMM(b.studyTime, '18:00');
    if (title.length < 2 || !Number.isFinite(examDate.getTime()) || examDate.getTime() < Date.now() - 86400000 || !topics.length) return res.status(400).json({ error: 'Add an exam title, a future exam date and at least one topic.' });
    const plan = await Plan.create({ userId: req.userId, title, subject: cleanText(b.subject, 60), examDate, dailyMinutes, studyTime, timeZone, topics });
    res.status(201).json({ id: String(plan._id) });
  }));

  router.post('/plans/:id/calendar/sync', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
    if (!CalendarConnection) return res.status(503).json({ error: 'Google Calendar connection storage is unavailable.' });
    const plan = await Plan.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const connection = await CalendarConnection.findOne({ userId: req.userId }).lean();
    if (!connection) return res.status(409).json({ error: 'Connect Google Calendar first.', code: 'CALENDAR_NOT_CONNECTED' });
    const config = calendarOAuthConfig();
    if (!config) return res.status(503).json({ error: 'Google Calendar OAuth is not configured on the server.', code: 'CALENDAR_NOT_CONFIGURED' });
    const client = calendarOAuthClient(config);
    client.setCredentials({ refresh_token: decryptRefreshToken(connection.refreshToken) });
    const access = await client.getAccessToken();
    const accessToken = typeof access === 'string' ? access : access && access.token;
    if (!accessToken) return res.status(502).json({ error: 'Could not refresh Google Calendar access. Reconnect your account.' });
    const tz = await userTimeZone(req.userId, (req.body && req.body.timeZone) || plan.timeZone);
    const startTime = normalizeTimeHHMM((req.body && req.body.startTime) || plan.studyTime, '18:00');
    const blocks = scheduleExamTimeBlocks(plan, { startTime, timeZone: tz });
    const api = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const listUrl = new URL(api);
    listUrl.searchParams.set('privateExtendedProperty', `nexosPlanId=${String(plan._id)}`);
    listUrl.searchParams.set('maxResults', '2500');
    const listResponse = await fetch(listUrl, { headers });
    const listData = await listResponse.json().catch(() => ({}));
    if (!listResponse.ok) return res.status(listResponse.status === 401 ? 401 : 502).json({ error: listData.error?.message || 'Could not read Google Calendar events.' });
    const existing = new Map((listData.items || []).filter((e) => e.id).map((e) => [e.id, e]));
    const desired = new Set();
    let created = 0, updated = 0, deleted = 0;
    for (const block of blocks) {
      const id = 'n' + crypto.createHash('sha256').update(`${plan._id}:${block.date}`).digest('hex').slice(0, 32);
      desired.add(id);
      const startDt = localDateTimeInZoneUtc(block.date, block.startTime, tz);
      const endDt = new Date(startDt.getTime() + block.minutes * 60000);
      const event = {
        id,
        summary: block.title.slice(0, 250),
        description: block.description.slice(0, 1000),
        start: { dateTime: startDt.toISOString(), timeZone: tz },
        end: { dateTime: endDt.toISOString(), timeZone: tz },
        extendedProperties: { private: { nexosPlanId: String(plan._id), nexosDate: block.date } },
      };
      const prior = existing.get(id);
      let response = await fetch(prior ? `${api}/${encodeURIComponent(id)}` : api, { method: prior ? 'PATCH' : 'POST', headers, body: JSON.stringify(event) });
      let existed = !!prior;
      if (!prior && response.status === 409) {
        existed = true;
        response = await fetch(`${api}/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify(event) });
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return res.status(502).json({ error: data.error?.message || 'Google Calendar could not save a study session.', created, updated, deleted });
      }
      if (existed) updated++; else created++;
    }
    for (const [id] of existing) {
      if (desired.has(id)) continue;
      const response = await fetch(`${api}/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (response.ok || response.status === 404) deleted++;
    }
    res.json({ ok: true, sessions: blocks.length, created, updated, deleted });
  }));

  router.get('/plans/:id/schedule', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
    const plan = await Plan.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const tz = await userTimeZone(req.userId, req.query.tz || plan.timeZone);
    const startTime = normalizeTimeHHMM(req.query.startTime || plan.studyTime, '18:00');
    const blocks = scheduleExamTimeBlocks(plan, { startTime, timeZone: tz });
    const examKey = zonedDateKey(new Date(plan.examDate), tz);
    const googleCalendarUrl = blocks.length
      ? buildGoogleCalendarUrl(blocks[0], { timeZone: tz, recurDaily: blocks.length > 1, recurUntilDateKey: examKey })
      : '';
    res.json({ planId: String(plan._id), title: plan.title, timeZone: tz, startTime, blocks, googleCalendarUrl });
  }));

  router.get('/plans/:id/calendar.ics', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
    const plan = await Plan.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const tz = await userTimeZone(req.userId, req.query.tz || plan.timeZone);
    const startTime = normalizeTimeHHMM(req.query.startTime || plan.studyTime, '18:00');
    const ics = buildExamPlanIcs(plan, { startTime, timeZone: tz });
    const slug = cleanText(plan.title, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exam-plan';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-revision.ics"`);
    res.send(ics);
  }));

  router.patch('/plans/:id/topics/:index', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
    const plan = await Plan.findOne({ _id: req.params.id, userId: req.userId });
    const index = Number(req.params.index);
    if (!plan || !Number.isInteger(index) || index < 0 || index >= plan.topics.length) return res.status(404).json({ error: 'Topic not found.' });
    const completed = new Set(plan.completedTopics || []);
    const topic = plan.topics[index];
    if (completed.has(topic)) completed.delete(topic); else completed.add(topic);
    plan.completedTopics = [...completed];
    await plan.save();
    res.json({ ok: true, completedTopics: plan.completedTopics });
  }));

  router.delete('/plans/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
    const existingPlan = await Plan.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!existingPlan) return res.status(404).json({ error: 'Plan not found.' });
    const config = calendarOAuthConfig();
    if (CalendarConnection && config) {
      const connection = await CalendarConnection.findOne({ userId: req.userId }).lean();
      if (connection) {
        try {
          const client = calendarOAuthClient(config);
          client.setCredentials({ refresh_token: decryptRefreshToken(connection.refreshToken) });
          const access = await client.getAccessToken();
          const accessToken = typeof access === 'string' ? access : access && access.token;
          if (accessToken) {
            const api = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
            const listUrl = new URL(api);
            listUrl.searchParams.set('privateExtendedProperty', `nexosPlanId=${String(existingPlan._id)}`);
            listUrl.searchParams.set('maxResults', '2500');
            const listed = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
            const data = await listed.json().catch(() => ({}));
            for (const event of data.items || []) {
              if (!event.id) continue;
              await fetch(`${api}/${encodeURIComponent(event.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
            }
          }
        } catch (_) { /* keep plan deletion resilient even if external OAuth token was revoked */ }
      }
    }
    const out = await Plan.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: out.deletedCount === 1 });
  }));

  return router;
}

module.exports = {
  defineModels,
  createRouter,
  nextReview,
  cleanText,
  validTimeZone,
  zonedDateKey,
  addDaysToKey,
  localDateTimeInZoneUtc,
  localStartOfDayUtc,
  computeNextDueAt,
  normalizeTimeHHMM,
  addMinutesToTime,
  scheduleExamTimeBlocks,
  buildGoogleCalendarUrl,
  buildExamPlanIcs,
  encryptRefreshToken,
  decryptRefreshToken,
};
