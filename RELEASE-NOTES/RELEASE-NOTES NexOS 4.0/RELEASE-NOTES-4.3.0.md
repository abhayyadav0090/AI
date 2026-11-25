# NexOS 4.3.0 — Habits, part 2

(Includes everything in 4.2.0: edit habits, current and best streak, weekly goals, milestones and the summary strip.)

## New (Classic and Enterprise)
- **Pause a habit** from its edit bar. It disappears from your day, the dashboard, the plan, the stats and NexAI's view, but all its history is kept. Paused habits sit in a **Paused habits** list with **Resume** and delete. Undo is offered right away.
- **Reorder:** **Up** and **Down** in the edit bar move a habit past its neighbouring active habit.
- **Habit details (▥):** that habit's own 12-week heatmap in its colour, plus last done, most frequent weekday, start date, best streak and reminder time.
- **Habit reminders:** set **Remind at** in the edit bar. NexOS sends a push notification at that time if the habit is not done yet, for example "Keep your 5-day streak going: Read 20 pages". Clear the time to turn it off.
  - It needs notifications turned on in Settings and push configured on the server (the same as task alerts, including the on/off switch).
  - Skipped for paused habits, habits already done today and weekly goals already met this week.
  - Sent only within three hours after the chosen time, so a sleeping free server does not send an evening reminder at midnight.

## Under the hood
- `public/habits.js` gains `move`, `heatmapHtml`, `insights`, `detailHtml` and `editExtrasHtml`.
- New `lib/habit-reminders.js` decides which reminders are due (pure, tested without a database). `server.js` only widens the existing push sweep to read `data.habits` and send these notices alongside task notices.
- Habits may carry `archived` and `remindAt` inside the workspace document. No new routes or collections.

## Unchanged
- Task alerts and their time, the heatmap on the Habits page (all habits, including paused ones' past check-ins), Study Studio, Day derailed, the sidebars and the Recovery Center.

## Version
- Package, lockfile, README, asset versions, service worker cache (`nexos-shell-v35`), Docker label and release tests are at 4.3.0. New test `scripts/test-habit-extras-430.js`.
