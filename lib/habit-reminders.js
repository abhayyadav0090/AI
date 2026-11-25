/* NexOS 4.3.0 — which habit reminders are due right now (pure, so it can be tested without a database).
   A habit may carry `remindAt` ("HH:MM" in the user's time zone). It is due from that time for a limited window
   (so a server that slept all evening does not send an old reminder at midnight), unless the habit is paused,
   already done today, or has a weekly goal that is already met this week. */
const NexHabits = require('../public/habits.js');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

function dueHabitReminders(habits, todayKey, nowTime, windowMinutes = 180) {
  if (!Array.isArray(habits) || !TIME.test(String(nowTime || ''))) return [];
  const now = toMinutes(nowTime);
  const out = [];
  for (const h of habits) {
    if (!h || typeof h !== 'object' || h.id == null || h.archived || !TIME.test(String(h.remindAt || ''))) continue;
    const since = now - toMinutes(h.remindAt);
    if (since < 0 || since > windowMinutes) continue;
    const st = NexHabits.stats(h, todayKey);
    if (st.doneToday) continue;
    if (st.mode === 'week' && st.weekDone >= st.goal) continue;
    out.push({ id: String(h.id), name: String(h.name || 'Habit').slice(0, 100), current: st.current, mode: st.mode });
    if (out.length >= 5) break;
  }
  return out;
}

function habitReminderKey(todayKey, habitId) { return `${todayKey}:habit:${String(habitId)}`; }

function habitReminderPayload(item) {
  const unit = item.mode === 'week' ? 'week' : 'day';
  const body = item.current > 0 ? `Keep your ${item.current}-${unit} streak going: ${item.name}` : `Time for: ${item.name}`;
  return { title: 'NexOS habit reminder', body: body.slice(0, 160), url: '/', tag: `nexos-habit-${item.id.slice(0, 80)}`, kind: 'habit', habitId: item.id };
}

module.exports = { dueHabitReminders, habitReminderKey, habitReminderPayload };
