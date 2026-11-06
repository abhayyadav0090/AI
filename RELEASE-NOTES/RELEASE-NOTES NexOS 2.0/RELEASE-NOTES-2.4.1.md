# NexOS 2.4.1

## Fixed
- **Enterprise: "Chat not found" when asking NexAI.** Enterprise remembers your last conversation. If that conversation had been deleted (from Classic's chat list, by the server's old-chat limit, or by a data reset), every later message was sent to a chat that no longer existed and failed, forever. Enterprise now forgets a missing conversation when it opens, and if one disappears while you are using it, it starts a new conversation with your message instead of showing an error. This also covers the NexAI side panel. The server now sends `code: "CHAT_NOT_FOUND"` for this case; older servers still work.
- **Classic: the greeting wrapped onto two lines** ("Good afternoon, / Abhay") because of an old width limit. It now uses the full width.

## Changed
- **Enterprise starts in the Overgame theme** (dark aubergine with orange accents) for new accounts. An account still on the old blue default moves to Overgame once; any theme you choose after that is kept. The saved theme is applied before the page paints, so there is no flash of another colour scheme.
- **Classic has a Classic | Enterprise switch at the top** of every screen (inside the menu on phones).
- **The paint-palette button in Classic's top bar opens a quick menu** (Google or Microsoft design, Light, Dark or Auto, and "More settings…") instead of jumping straight into the Settings dialog.

## Unchanged
Everything else is as in 2.4.0.
