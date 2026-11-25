'use strict';
// NexOS 4.5.1: Study Studio complete integration tests (Google Calendar time-blocks,
// Habits streak/daily-goal sync, Spaced revision push notifications, and auto next due date).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const planner = require('../lib/study-planner.js');
const reminders = require('../lib/study-reminders.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  // 1) Pure due-date computation (late-night review schedules start of target day in user's timezone)
  {
    const lateNightIst = new Date('2026-11-25T17:20:00.000Z'); // 22:50 IST on 2026-11-25
    const due1 = planner.computeNextDueAt(lateNightIst, 1, 'Asia/Kolkata');
    assert.equal(planner.zonedDateKey(due1, 'Asia/Kolkata'), '2026-11-26');
    assert.equal(due1.toISOString(), '2026-11-25T18:30:00.000Z', '2026-11-26 00:00 IST in UTC');
    assert.ok(due1.getTime() > lateNightIst.getTime(), 'next due date is strictly after today');
    const due7 = planner.computeNextDueAt(lateNightIst, 7, 'Asia/Kolkata');
    assert.equal(planner.zonedDateKey(due7, 'Asia/Kolkata'), '2026-12-02');
  }

  // 2) Exam plan time-blocks, Google Calendar URL & .ics export
  {
    const plan = {
      _id: '507f1f77bcf86cd799439011',
      title: 'Operating Systems',
      subject: 'CS',
      examDate: new Date('2026-12-01T00:00:00.000Z'),
      dailyMinutes: 90,
      topics: ['Processes', 'Scheduling', 'Deadlocks', 'Virtual Memory'],
      completedTopics: ['Processes'],
    };
    const blocks = planner.scheduleExamTimeBlocks(plan, { startDateKey: '2026-11-25', startTime: '18:30', timeZone: 'Asia/Kolkata' });
    assert.ok(blocks.length >= 3, 'creates multi-day blocks up to exam');
    assert.equal(blocks[0].date, '2026-11-25');
    assert.equal(blocks[0].startTime, '18:30');
    assert.equal(blocks[0].endTime, '20:00');
    assert.ok(!blocks.some((b) => b.topics.includes('Processes')), 'completed topic is skipped');
    const url = planner.buildGoogleCalendarUrl(blocks[0], { timeZone: 'Asia/Kolkata', recurDaily: true, recurUntilDateKey: '2026-12-01' });
    assert.ok(url.startsWith('https://calendar.google.com/calendar/render?'));
    assert.ok(url.includes('action=TEMPLATE') && url.includes('20261125T183000%2F20261125T200000') && url.includes('RRULE%3AFREQ%3DDAILY'));
    const ics = planner.buildExamPlanIcs(plan, { startDateKey: '2026-11-25', startTime: '18:30', timeZone: 'Asia/Kolkata' });
    assert.ok(ics.includes('BEGIN:VCALENDAR') && ics.includes('BEGIN:VEVENT') && ics.includes('DTSTART;TZID=Asia/Kolkata:20261125T183000'));
    assert.ok(ics.includes('SUMMARY:Revise: Operating Systems (CS)'));
  }

  // 3) Spaced revision push reminder helpers
  {
    const now = new Date('2026-11-25T09:00:00.000Z');
    const due = reminders.dueStudyReminders([
      { _id: '1', topic: 'Future topic', dueAt: new Date('2026-11-26T00:00:00.000Z') },
      { _id: '2', topic: 'Binary trees', dueAt: new Date('2026-11-24T18:30:00.000Z') },
      { _id: '3', topic: 'Paging', dueAt: new Date('2026-11-25T00:00:00.000Z') },
    ], now);
    assert.equal(due.dueCount, 2);
    assert.deepEqual(due.items.map((x) => x.topic), ['Binary trees', 'Paging']);
    const key = reminders.studyReminderKey('2026-11-25');
    assert.equal(key.slice(0, 10), '2026-11-25');
    const payload = reminders.studyReminderPayload(due);
    assert.equal(payload.kind, 'study');
    assert.equal(payload.url, '/?study=revision');
    assert.ok(payload.body.includes('2 study topics'));
  }

  // 4) Router endpoints with in-memory models (dedup POST /reviews, rate sets dueAt, schedule & ics)
  {
    let seq = 1;
    const newId = () => String(seq++).padStart(24, '0');
    const makeStore = () => {
      const rows = [];
      const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k] ?? '') === String(v ?? ''));
      class Q {
        constructor(list) { this.list = list; }
        select() { return this; }
        sort() { return this; }
        limit(n) { this.list = this.list.slice(0, n); return this; }
        lean() { return this; }
        then(res, rej) { return Promise.resolve(this.list.map((x) => ({ ...x }))).then(res, rej); }
      }
      return {
        rows,
        find: (f) => new Q(rows.filter((r) => match(r, f))),
        findOne: (f) => {
          const found = rows.find((r) => match(r, f));
          const obj = found ? Object.assign(found, { save: async () => found }) : null;
          const q = new Q(obj ? [obj] : []);
          q.then = (res, rej) => Promise.resolve(obj).then(res, rej);
          return q;
        },
        countDocuments: async (f) => rows.filter((r) => match(r, f)).length,
        create: async (d) => { const r = { ...d, _id: newId(), createdAt: new Date(), updatedAt: new Date() }; rows.push(r); return r; },
        deleteOne: async (f) => { const i = rows.findIndex((r) => match(r, f)); if (i >= 0) { rows.splice(i, 1); return { deletedCount: 1 }; } return { deletedCount: 0 }; },
      };
    };
    const Review = makeStore();
    const Plan = makeStore();
    const PushPreference = makeStore();
    const A = 'a'.repeat(24), B = 'b'.repeat(24);
    const router = planner.createRouter({
      mongoose: { model: () => makeStore() },
      StudyReview: Review,
      StudyExamPlan: Plan,
      PushPreference,
      requireAuth: (req, res, next) => { req.userId = req.get('x-user') || A; next(); },
      isValidId: (id) => /^[0-9a-f]{24}$/.test(String(id)),
    });
    const app = express(); app.use(express.json()); app.use('/api/study', router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/study';
    try {
      // Deduplicate review creation for identical topic
      const r1 = await fetch(base + '/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': A }, body: JSON.stringify({ topic: 'Deadlocks', prompt: 'Conditions' }) }).then((r) => r.json());
      const r2 = await fetch(base + '/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': A }, body: JSON.stringify({ topic: 'Deadlocks', prompt: '4 Coffman conditions' }) }).then((r) => r.json());
      assert.equal(r1.id, r2.id, 're-adding same topic updates instead of duplicating');
      assert.equal(Review.rows.length, 1);

      // Rating automatically schedules next due date
      const rated = await fetch(base + `/reviews/${r1.id}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': A }, body: JSON.stringify({ rating: 'good', timeZone: 'Asia/Kolkata' }) }).then((r) => r.json());
      assert.equal(rated.ok, true);
      assert.equal(rated.intervalDays, 1);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rated.dueDateKey));
      assert.ok(new Date(rated.dueAt).getTime() > Date.now());

      // Exam plan schedule + ICS + user isolation
      const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      const created = await fetch(base + '/plans', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': A }, body: JSON.stringify({ title: 'DBMS', examDate: future, dailyMinutes: 45, topics: ['Normalization', 'B+ Trees'] }) }).then((r) => r.json());
      const sched = await fetch(base + `/plans/${created.id}/schedule?startTime=19:00&tz=Asia/Kolkata`, { headers: { 'x-user': A } }).then((r) => r.json());
      assert.ok(sched.blocks.length >= 1 && sched.blocks[0].startTime === '19:00');
      assert.ok(sched.googleCalendarUrl.includes('https://calendar.google.com/calendar/render'));
      const icsRes = await fetch(base + `/plans/${created.id}/calendar.ics?startTime=19:00&tz=Asia/Kolkata`, { headers: { 'x-user': A } });
      assert.ok((icsRes.headers.get('content-type') || '').includes('text/calendar'));
      const icsText = await icsRes.text();
      assert.ok(icsText.includes('BEGIN:VCALENDAR') && icsText.includes('Revise: DBMS'));
      const forbidden = await fetch(base + `/plans/${created.id}/schedule`, { headers: { 'x-user': B } });
      assert.equal(forbidden.status, 404, 'cannot access another user exam schedule');
    } finally {
      server.close();
    }
  }

  // 5) Optional Google Calendar OAuth token encryption & wiring checks
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'nexos-test-secret-that-is-not-used-in-production';
  const encrypted = planner.encryptRefreshToken('google-refresh-token');
  assert.notEqual(encrypted, 'google-refresh-token');
  assert.equal(planner.decryptRefreshToken(encrypted), 'google-refresh-token');
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;

  const srv = read('server.js');
  const ui = read('public/study.js');
  const classic = read('public/app.js');
  const ent = read('public/index-redesign.html');
  assert.ok(srv.includes('StudyCalendarConnection.deleteOne({ userId: req.userId })'), 'account deletion cleans up calendar tokens');
  assert.ok(srv.includes('dueStudyReminders') && srv.includes('studyReminderPayload'), 'server push sweep sends spaced revision reminders');
  assert.ok(ui.includes('Add to Google Calendar') && ui.includes('Download .ics') && ui.includes('Study streak &amp; daily goal'), 'Study Studio UI exposes Google Calendar, .ics, and Habit streak sync');
  assert.ok(ui.includes('Upcoming scheduled revisions'), 'Study Studio shows auto-scheduled upcoming due dates');
  assert.ok(classic.includes('classicRecordStudyCheckIn') && classic.includes('getStudyHabit: classicStudyHabitInfo'), 'Classic wires Study Studio to Habits and Tasks');
  assert.ok(ent.includes('enterpriseRecordStudyCheckIn') && ent.includes('getStudyHabit: enterpriseStudyHabitInfo'), 'Enterprise wires Study Studio to Habits and Tasks');
  assert.ok(classic.includes("study') === 'revision'") && ent.includes("study') === 'revision'"), 'both UIs open Study Studio Revision tab on push click');

  console.log('Study Studio 4.5.1 complete integration tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
