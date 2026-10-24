# NexOS 2.2.0 — UI Reliability & Productivity Polish

## Design and experience
- Refined NexOS into a calmer productivity-workspace UI inspired by Material-style hierarchy and Fluent-style spacing, while retaining NexOS's own aubergine, marigold and ice-silver palette.
- Added a responsive quick-settings popover at tablet and phone widths for notification permission, task reminder ON/OFF and time, and JSON export/import controls.
- Added consistent, visible `:focus-visible` treatment and improved disabled-control feedback.
- Tightened mobile topbar sizing, dashboard action spacing, and small-screen popover sizing.
- Updated the PWA manifest base colors to match the app's dark theme and optimized the font request to only load fonts used by the UI.

## Correctness and accessibility
- Fixed mobile navigation accessibility state with `aria-hidden`, `inert`, expanded labels, Escape/backdrop close behavior, focus restoration, and resize reconciliation.
- Fixed Profile opened from the mobile drawer so it also removes the drawer backdrop and page scroll lock.
- Added validation before switching sections to prevent a bad view name from blanking the workspace.
- Added a timeout for Google Identity Services loading so the sign-in screen can return a useful error instead of waiting forever.
- Keep the greeting/date correct if the tab remains open across an hour or midnight.
- Today's dashboard task list now sorts by priority, then due date and recency.
- Habit checkmark foreground color now adapts to user-selected habit colors for better contrast.
- Fixed guest reminder settings: reminder ON/OFF and time now persist locally for guest mode; guests are not sent to sign-in-only push APIs.
- Corrected primary-button color tokens so dark mode uses a lighter aubergine control surface instead of a low-contrast dark-on-dark button.
- Synchronized `package.json` and `package-lock.json` release versions (2.2.0).

## Preserved
- Dashboard Plan My Day, Ask NexAI and Action Mode actions.
- Task/notes/habits/focus state shape, Google sign-in, MongoDB integration, existing AI endpoints, and configurable task reminder ON/OFF/time settings.
- No Render environment variables, secrets, or Kartik Maas files are changed by this release.

## Validation
- JavaScript syntax checks, CSS parsing, JSON parsing, HTML ID/handler-reference checks, required-feature checks and ZIP integrity are run locally.
- Live Render deployment, browser-level interaction on real devices, Google sign-in, MongoDB, and actual Web Push delivery have not been tested as part of this ZIP build.
