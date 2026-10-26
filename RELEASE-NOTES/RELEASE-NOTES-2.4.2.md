# NexOS 2.4.2

## Added
- **Classic | Enterprise switch in the quick appearance menu.** The paint-palette button in Classic's top bar now shows an Experience row (Classic, Enterprise) above Design and Theme. This matters most on phones, where the top bar has no room for the switch. The switch at the top of the page on desktop and the one inside the phone menu are unchanged.

## Fixed
- **A long note or task title could stretch the whole page sideways on a phone.** On the Home screen the "Recent notes" preview (and long task and habit names) widened the page past the screen edge. That pushed the top bar's buttons (palette, profile) off-screen and made the bottom bar wider than the phone. Long text is now cut off with "…" instead. Checked with very long titles on every Classic screen (Google and Microsoft designs, 360 and 390 px wide) and every Enterprise screen: 48 of 48 fit.

## Housekeeping
- Release notes live in the `RELEASE-NOTES/` folder, matching your repository.
- `test_server.py` and `test_server.pid` (left over from an earlier build) are not included; you can remove them from the repository with `git rm test_server.py test_server.pid`.

Everything else is as in 2.4.1.
