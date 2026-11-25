'use strict';
// NexOS 4.5.0 — persistent Study Studio revision queue and exam plans.

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
    topics: [{ type: String, maxlength: 120 }],
    completedTopics: [{ type: String, maxlength: 120 }],
  }, { timestamps: true });
  planSchema.index({ userId: 1, examDate: 1 });
  return {
    StudyReview: mongoose.models.StudyReview || mongoose.model('StudyReview', reviewSchema),
    StudyExamPlan: mongoose.models.StudyExamPlan || mongoose.model('StudyExamPlan', planSchema),
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
function createRouter({ mongoose, StudyReview: Review, StudyExamPlan: Plan, requireAuth, isValidId }) {
  const express = require('express');
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  router.get('/reviews', requireAuth, wrap(async (req, res) => {
    const now = new Date();
    const items = await Review.find({ userId: req.userId }).sort({ dueAt: 1, updatedAt: -1 }).limit(300).lean();
    res.json({
      items: items.map((x) => ({ id: String(x._id), topic: x.topic, prompt: x.prompt, answer: x.answer, dueAt: x.dueAt, intervalDays: x.intervalDays, repetitions: x.repetitions, lastRating: x.lastRating, documentId: x.documentId ? String(x.documentId) : null, sourcePage: x.sourcePage })),
      due: items.filter((x) => new Date(x.dueAt) <= now).length,
      total: items.length,
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
    const reviewCount = await Review.countDocuments({ userId: req.userId });
    if (reviewCount >= 500) return res.status(403).json({ error: 'Revision queue is full (500 items). Clear older items to add more.' });
    const item = await Review.create({ userId: req.userId, documentId, topic, prompt: cleanText(body.prompt, 500), answer: cleanText(body.answer, 800), sourcePage: Number.isInteger(body.sourcePage) && body.sourcePage > 0 ? body.sourcePage : null, dueAt: new Date() });
    res.status(201).json({ id: String(item._id), topic: item.topic, dueAt: item.dueAt });
  }));
  router.post('/reviews/:id/rate', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Revision item not found.' });
    const rating = String((req.body || {}).rating || '');
    if (!['again', 'hard', 'good'].includes(rating)) return res.status(400).json({ error: 'Choose Again, Hard or Got it.' });
    const item = await Review.findOne({ _id: req.params.id, userId: req.userId });
    if (!item) return res.status(404).json({ error: 'Revision item not found.' });
    const schedule = nextReview(item.intervalDays, rating, item.repetitions);
    item.intervalDays = schedule.intervalDays;
    item.repetitions = schedule.repetitions;
    item.lastRating = rating;
    item.lastReviewedAt = new Date();
    item.dueAt = new Date(Date.now() + schedule.intervalDays * 86400000);
    await item.save();
    res.json({ ok: true, dueAt: item.dueAt, intervalDays: item.intervalDays });
  }));
  router.delete('/reviews/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Revision item not found.' });
    const out = await Review.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: out.deletedCount === 1 });
  }));
  router.get('/plans', requireAuth, wrap(async (req, res) => {
    const plans = await Plan.find({ userId: req.userId }).sort({ examDate: 1 }).lean();
    res.json({ plans: plans.map((p) => ({ id: String(p._id), title: p.title, subject: p.subject, examDate: p.examDate, dailyMinutes: p.dailyMinutes, topics: p.topics || [], completedTopics: p.completedTopics || [] })) });
  }));
  router.post('/plans', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const title = cleanText(b.title, 100);
    const examDate = new Date(b.examDate);
    const topics = Array.isArray(b.topics) ? [...new Set(b.topics.map((x) => cleanText(x, 120)).filter((x) => x.length >= 2))].slice(0, 80) : [];
    const dailyMinutes = Math.max(10, Math.min(600, Math.round(Number(b.dailyMinutes) || 60)));
    if (title.length < 2 || !Number.isFinite(examDate.getTime()) || examDate.getTime() < Date.now() - 86400000 || !topics.length) return res.status(400).json({ error: 'Add an exam title, a future exam date and at least one topic.' });
    const plan = await Plan.create({ userId: req.userId, title, subject: cleanText(b.subject, 60), examDate, dailyMinutes, topics });
    res.status(201).json({ id: String(plan._id) });
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
    const out = await Plan.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: out.deletedCount === 1 });
  }));
  return router;
}
module.exports = { defineModels, createRouter, nextReview, cleanText };
