# NexOS 4.2.0 — A much better habit tracker

## New (Classic and Enterprise)
- **Edit a habit:** a ✎ button next to every habit's name opens an edit bar under it for the **name, colour and goal**. Save (or Enter) applies it, Cancel (or Esc) discards it. Check-ins are kept because they follow the habit's id. The name is trimmed, limited to 80 characters, and cannot be empty.
- **Current streak and best streak** on every habit, with a "personal best 🏆" mark when you are on your longest run. The streak stays alive through today until you have had a chance to tick it.
- **Completion rate** over the last 30 days (a young habit is measured over the days it has existed, at least 7) and **total check-ins**.
- **Milestone badges:** 7, 14, 30, 60, 100, 200 and 365 days, shown as "🏅 30-day club".
- **Flexible goals:** every day, or 1 to 6 days a week. Habits with a weekly goal count **weeks in a row** (Monday to Sunday) that reached the goal and show "3/5 this week", so planned rest days no longer break a streak. The week in progress is never held against you.
- **Summary strip** above the list: done today, longest current streak, 30-day rate and total check-ins.
- Hover a habit's streak line for the full numbers.

## Under the hood
- New `public/habits.js` holds all the maths as pure functions, shared by both pages and covered by `scripts/test-habit-stats-420.js`. It never writes data: the stored `streak` field and NexAI's view of habits are unchanged.
- A habit may carry an optional `goal` (1 to 7) in the workspace document. No server or API change.

## Unchanged
- The server and its API, Classic and Enterprise layouts, the heatmap, Study Studio, Day derailed and the Recovery Center. Deleting a habit still offers Undo.

## Version
- Package, lockfile, README, asset versions, service worker cache (`nexos-shell-v34`, now precaching `habits.js`), Docker label and release tests are at 4.2.0. New tests: `test-habit-edit-420.js` and `test-habit-stats-420.js`.
