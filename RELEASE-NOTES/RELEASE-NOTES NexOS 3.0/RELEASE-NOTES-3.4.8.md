# NexOS 3.4.8 — Guest Sign in on Phones and a Bluer Glass

## Classic: Sign in is easy to find for guests (phones)
- Guests now see a **Sign in** button in the top bar, between the page title and search, on every view. It runs the same action as the Sign in button in the dashboard banner.
- Signed-in users never see it. Desktop layout is unchanged.
- The grey guest sync dot is hidden on phones (guest data is never synced, so it only confused).
- Long page titles shorten with "…" instead of pushing the top bar apart.

## Enterprise: Glass vs Violet Orchid
- Glass now uses blue with a cyan secondary (it had a purple secondary and gradient), so it no longer looks like Violet Orchid. Its preview card shows the new colours.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v26`), Docker label and release tests are all at 3.4.8. New test: `scripts/test-guest-signin-348.js`.

## Preserved
- Dashboard guest banner, Profile avatar, the Recovery Center, NexAI, attachments, other themes and workspace data are untouched.
