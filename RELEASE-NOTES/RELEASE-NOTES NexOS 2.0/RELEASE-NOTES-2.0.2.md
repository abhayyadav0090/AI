# NexOS 2.0.2 — Task Reminder ON/OFF

- Added a saved ON/OFF setting for due-date and overdue-task reminders.
- The setting controls both local browser notifications and background Web Push task alerts.
- Turning reminders off does not delete tasks, change due dates, or revoke browser notification permission.
- The daily reminder time remains configurable (default 09:00 Asia/Kolkata).
- Reminder preferences are stored separately from task state in MongoDB.

Validation: JavaScript syntax checks and ZIP integrity checks passed. Live deployment and real push delivery have not been tested here.
