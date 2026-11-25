'use strict';
// NexOS 4.5.1 — Spaced revision push reminder helpers (pure, testable without MongoDB).

function dueStudyReminders(reviews, now = new Date(), limit = 5) {
  if (!Array.isArray(reviews)) return { dueCount: 0, items: [] };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { dueCount: 0, items: [] };

  const due = reviews
    .filter((r) => r && typeof r === 'object' && r.dueAt && new Date(r.dueAt).getTime() <= nowMs)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  const items = due.slice(0, limit).map((r) => ({
    id: r._id != null ? String(r._id) : String(r.id || ''),
    topic: String(r.topic || 'Revision topic').replace(/\s+/g, ' ').trim().slice(0, 80),
    dueAt: r.dueAt,
  }));

  return { dueCount: due.length, items };
}

function studyReminderKey(todayKey) {
  return `${todayKey}:study-revision`;
}

function studyReminderPayload(summary) {
  const count = summary && Number(summary.dueCount) || 0;
  const topics = (summary && Array.isArray(summary.items) ? summary.items : [])
    .map((x) => x.topic)
    .filter(Boolean)
    .slice(0, 2);
  const preview = topics.length ? `: ${topics.join(', ')}${count > topics.length ? '…' : ''}` : '';
  const body = count === 1
    ? `1 study topic is due for spaced revision${preview}`
    : `${count} study topics are due for spaced revision${preview}`;
  return {
    title: 'NexOS Study Revision',
    body: body.slice(0, 160),
    url: '/?study=revision',
    tag: 'nexos-study-revision',
    kind: 'study',
  };
}

module.exports = { dueStudyReminders, studyReminderKey, studyReminderPayload };
