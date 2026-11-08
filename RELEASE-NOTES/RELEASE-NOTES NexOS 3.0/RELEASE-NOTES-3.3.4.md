# NexOS 3.3.4 — Classic NexAI Exact Fit

Fixes the Classic NexAI page on phones. The voice and keyboard behaviour from 3.3.3 is unchanged, and so is the Recovery Center.

## Changes
- **No more scrolling under the top bar (Classic, phones).** The page height used fixed guessed numbers, which did not match every design (Google or Apple), theme or phone. A few dozen pixels of extra height let the page scroll, and the Action, New, Context and History buttons slid under the top bar. The NexAI page is now sized from the real space between the top bar and the bottom nav, re-measured on rotation, resize and when the bars change size, and the page itself no longer scrolls. Only the chat inside it scrolls.
- Phone layout only. Desktop is unchanged.

- **README.** The Google and Apple design screenshots are shown again at the top, the 3.3.2 to 3.3.4 entries are listed in the release history, and short 1.0 and 1.1 entries describe the first versions.

## Notes
- No server, database or environment-variable change is required.

## Verification
- Run `npm test` before deployment.
- After deployment, open the installed app once online, close it, reopen it. In Classic, open NexAI in Chrome and in the installed app, drag the page up and down, and check the four buttons stay below the top bar.
