# NexOS 2.0.1 — Configurable task reminder time

- Added a daily reminder-time control beside the notification bell (default 09:00 IST).
- Saves each signed-in user's reminder time in a separate MongoDB collection.
- Applies the selected time to in-app due/overdue notifications and server-side Web Push task alerts.
- Preserves the current NexOS/Kartik shared-host and push-subscription changes from the supplied running ZIP.
- No new environment variables or VAPID key changes are required.

Note: the server scheduler polls every five minutes. If the Render service sleeps, background reminders may be delayed until it wakes.
