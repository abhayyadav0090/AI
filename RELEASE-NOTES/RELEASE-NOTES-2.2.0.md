# NexOS 2.2.0: design, features and bug fixes

## New design
- **Two designs, one switch.** Settings → Appearance (or the palette icon in the top bar, or the sign-in screen) switches between **Google** (Material 3: tonal surfaces, pill controls, gradient greeting, navigation rail) and **Microsoft** (Fluent 2: brand-blue header, compact 4 px controls, left-indicator navigation). Each has light, dark and *match device* themes. The choice is saved per device.
- Real SVG icons instead of text symbols; one consistent look in every view.
- Phones get a bottom navigation bar and a floating **New** button. The overflowing top bar is gone.

## New features
- **Home** with an "Ask NexAI" box, quick chips, tasks you can tick off in place, habit check-ins and a sorted priorities list (overdue, then due today, then by priority).
- **Command palette** (`Ctrl+K`): jump to any view, create things, start the timer, switch design, or search tasks and notes with arrow-key navigation.
- **Task list view** next to the board, grouped by Overdue / Today / Upcoming / No due date / Completed.
- **Undo** after deleting or completing a task, deleting a habit or deleting a note.
- **Notes autosave** and a back button on phones.
- **Sync status** chip (Saved, Saving, Offline, Sign in to sync).
- **Offline friendly:** a returning user stays signed in through a server hiccup or no connection, the app shell loads from a cache, and changes sync when the connection returns.
- **Reminder time zone** per user (defaults to India time, switches to your device's zone when you save reminders).
- NexAI replies render lists, code blocks, links and bold text safely.
- Countdown in the browser tab title while the focus timer runs, plus a notification when a session ends in a background tab.
- Keyboard shortcuts list (`?`), accessible dialogs (focus moves in, is kept inside, and returns), skip link.

## Bugs fixed
**Server**
- Same-site requests could fail with a 500 error when `ALLOWED_ORIGINS` was missing or had a typo. The app's own host is now always allowed; foreign origins get a clear JSON 403.
- Unknown `/api/...` URLs returned the home page with status 200. They now return a JSON 404, and server errors are always JSON.
- Sign-out and the push config waited up to 8 seconds when the database was slow or down.
- The reminder job loaded every user's full data every 5 minutes. It now loads only users who have a reminder subscription.
- Generated VAPID private keys could be one byte short about 1 time in 256.
- Deleting your data did not sign out other devices, which could write the deleted data back. They are now signed out.
- Google sign-in failures were silent in the logs; the reason is now logged. Missing settings are reported at startup.
- Static files were never cached; they now revalidate with ETags. The content-security policy no longer allows `unsafe-eval`.
- `docker-compose.yml` referenced a Dockerfile that did not exist; one is included.

**App**
- Habit streaks showed 0 every morning until today was ticked.
- Text typed in a note was lost if you opened another note before pressing Save.
- On phones, opening Profile from the menu left the page dimmed and scroll-locked.
- The focus timer ran slow in background tabs; it now follows the clock.
- Habit colours saved by older versions were invisible in one theme.
- "Today's priorities" ignored priority and due date, and the stat cards showed fixed "up" arrows.
- Ctrl+1 to Ctrl+7 never worked in Chrome and Firefox because browsers reserve them; use Alt+1 to Alt+7.
- Esc did not close every dialog; the Google sign-in button could wait forever if its script was blocked.
- Drag highlights could stay stuck after dropping outside the board; analytics charts were rebuilt while hidden.
- Browser alert pop-ups were replaced by non-blocking messages. A session that expires now says so instead of failing silently.
- The Alerts checkbox overlapped its label and the reminder time was cut off.
- The account-deletion text now says what is kept: the Google name, email and photo record stays on the server because it can be shared with other apps. The privacy page says the same.

## Known limitation
Two devices editing at the same moment still follow "last save wins" for the whole workspace. Autosave keeps the window small; a per-item merge is a good next step.
