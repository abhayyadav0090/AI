# NexOS 3.3.3 — NexAI Fit and Keyboard

Two fixes for NexAI on phones, in Enterprise and Classic voice input. Everything else is unchanged, including the Recovery Center.

## Changes
- **NexAI page fits the screen (Enterprise, phones).** The page used to be a few pixels taller than the screen, so it scrolled and the Action, New, Context and History buttons slid under the top bar. The page is now sized from the real top bar height and does not scroll; only the chat inside it scrolls.
- **Keyboard stays closed after dictation.** When the mic starts, the message box is released from focus, and the keyboard is held back while listening and for a moment after speech ends. Tap the box yourself and the keyboard opens as normal. This applies to Classic and Enterprise, including Action Mode and Add Task.

## Notes
- No server, database or environment-variable change is required.

## Verification
- Run `npm test` before deployment.
- After deployment, open the installed app once online, close it, reopen it. Check on a phone that (1) the NexAI page no longer scrolls and its top buttons stay visible, and (2) the keyboard does not pop up when the mic stops.
