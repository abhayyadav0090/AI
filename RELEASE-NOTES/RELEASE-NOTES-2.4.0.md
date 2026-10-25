# NexOS 2.4.0: Classic and Enterprise together

NexOS now has two experiences on one account and one set of data:

| Address | Experience |
| --- | --- |
| `/` and `/classic` | **Classic**: the simple, focused version (unchanged from 2.2.0 apart from the fix below) |
| `/enterprise` (also `/redesign`) | **Enterprise**: adds a timeblocking calendar, a focus studio with ambient sound, a richer kanban board, analytics and a NexAI side panel |

Tasks, habits, notes and focus history are shared. Change something in one and it is there in the other. Both have a switch (Settings → Experience in Classic, the Classic/Enterprise switch in Enterprise).

## Classic
- **Settings no longer raises the on-screen keyboard.** Dialogs used to focus their first text field when they opened, which brought up the phone keyboard and pushed the layout around. They now focus the dialog itself, and text fields are 16 px on touch screens so iPhones do not zoom in when you tap one.
- Added an Experience section in Settings and an "Open Enterprise mode" command in the palette.
- Arriving from Enterprise's Sign in button (`/classic?next=enterprise`), Classic sends you back to Enterprise once you are signed in or continue as a guest.

## Enterprise: bugs fixed
**Navigation, sidebar and top bar**
- **Phone drawer: taps did nothing.** A dimming layer sat on top of the drawer, so tapping any item (or the footer buttons) hit the layer and just closed the menu. The bottom bar also covered the drawer's footer. Both are fixed.
- **Top bar overflowed at common laptop widths** (1366, 1180, 1024 px): the Plan Day button and the clock were pushed off-screen. Display, density, theme, sound and reminders now live in a settings popover (the gear), and everything fits from 320 px up.
- The closed phone drawer was still reachable with the keyboard and by screen readers. It is now hidden until opened, moves focus in when it opens, closes with Escape and returns focus to where you were.
- Growing the window while the drawer is open leaves nothing stuck.
- The bottom bar showed nothing selected on Habits, Calendar or Analytics. "More" now lights up.
- The active menu item now announces itself (`aria-current`); an unknown view name no longer blanks the screen.
- **Shortcuts:** Ctrl+1 to Ctrl+8 are reserved by browsers and never reached the page. Views are now Alt+1 to Alt+8 (labels show the keys that work; hidden on touch screens). Ctrl+K and Ctrl+\ are unchanged.
- The Classic/Enterprise switch was shown twice on desktop; it is now shown once.

**Data**
- **Dates used UTC.** Between midnight and 5:30 AM in India, habit ticks and focus sessions were filed under yesterday and disagreed with Classic. Everything uses your local day now.
- **Saving could wipe changes made on another device.** A task added on your phone vanished the next time Enterprise saved. Saves now merge by item: other devices' additions, edits and deletions are kept, your own edits win on the same field, and you are told when the screen updated.
- Habit streaks showed 0 every morning until you ticked today.
- Reminder time zones: saving reminders now sends your device's time zone (used to be fixed to India time).

**Honesty**
- **"AI Summarize" and "AI Breakdown" pasted fixed text** into your note or task whatever it said. They now call Gemini; without a signed-in account they leave your text alone and say why.
- The assistant is called **NexAI** everywhere. There was never a separate Copilot (that is a Microsoft product name) and no "dual AI". A leftover canned-reply generator and seven duplicate function definitions were removed.
- "Habit Streaks" showed a percentage (now "Habits Today"), and a fixed "↑" arrow was removed.

**Accessibility and polish**
- Visible keyboard focus everywhere (several components had turned it off); buttons that only had an icon now have names; dialogs are labelled, take focus, keep Tab inside and return focus when closed; reduced-motion is respected.
- The focus timer now follows the clock, so it no longer runs slow in a background tab, and it shows the countdown in the browser tab title.
- A Sign in link appears in preview mode (it was only reachable by finding Classic first).
- Works offline once opened (service worker), and has a web-app manifest.

## Server and docs
- Routes for Classic and Enterprise, JSON 404 for unknown `/api` paths, same-origin requests never blocked by `ALLOWED_ORIGINS`, deleted accounts sign out other devices, reminder job loads only subscribed users (all from 2.2.0, kept).
- `npm test` now checks every script and runs the Enterprise unit tests, including the new merge and local-date tests.
- Removed stray `test_server.py` / `test_server.pid` files from the earlier Enterprise build.

## Known limitations
- Classic still saves its whole workspace when it saves, so editing in Classic on a stale screen can overwrite newer changes from another device. Enterprise now merges; bringing the same merge to Classic is the natural next step.
- Enterprise is one large page (`public/index-redesign.html`). Splitting it into separate files would make it easier to maintain.
