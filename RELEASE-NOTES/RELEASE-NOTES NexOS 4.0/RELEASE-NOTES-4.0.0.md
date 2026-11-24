# NexOS 4.0.0 — Day derailed and the guest sample

## New
- **Day derailed:** a button on the Classic dashboard and the Enterprise dashboard. Pick how much time you lost (1 hour, 2 hours, 3 hours or the rest of the day). NexAI looks at your open tasks that are due today, overdue or undated, and proposes which to **move to tomorrow**, instead of squeezing the old plan into fewer hours. Untick anything you want to keep, then approve. Only due dates change; nothing is deleted or created.
- **Guest sample:** guests cannot use NexAI, so the best feature was the one a visitor could not try. Action Mode ("Draft actions" / "Draft Proposed Actions") and Day derailed now open a scripted sample with demo tasks and the same tick-and-approve interface. It makes no AI call, saves nothing, and finishes with a **Sign in with Google** button.

## How it stays safe
- The model only sees task titles, priority, stage and date, and may only name task IDs it was given; unknown or repeated IDs are dropped and at most 8 tasks are proposed.
- Nothing is applied until you tick proposals and tap Approve.
- Guests never reach the AI from this feature.

## Documentation
- `mds/ARCHITECTURE.md`: header and theme count corrected (five Enterprise themes), Day derailed and guest sample described.
- `mds/API.md`: health example, change notes for 3.4.1 to 4.0.0, chat streaming and history wording, and the `DELETE /api/me` text now match the code.
- README: 3.4.5 now links its release notes.

## Unchanged
- Classic and Enterprise layouts, themes, NexAI chat, Action Mode (signed in), the server and its API, and the Recovery Center.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v29`, now precaching `derail.js`), Docker label and release tests are all at 4.0.0. New test `scripts/test-derail-400.js`; `npm test` also syntax-checks `public/derail.js`.
