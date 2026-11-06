# NexOS 3.0.0 — Performance and Responsiveness Release

## Performance
- Added authenticated `GET /api/bootstrap`, returning the signed-in user's public identity and workspace snapshot together. Classic and Enterprise no longer need separate serial identity and workspace reads during startup.
- Kept `/api/me` and `/api/state` available for existing clients and later workspace sync.
- Changed read-only authentication/workspace queries to use lean Mongoose results; workspace reads select only the stored `data` field.
- Removed Enterprise's unused mouse spotlight work. It previously scanned all cards, read every card's layout rectangle and wrote CSS variables on every mouse movement, even though no stylesheet consumed those variables.
- Scoped Classic and Enterprise dialog MutationObservers to their actual dialog roots instead of observing class/style mutations throughout the entire application.
- Enterprise's clock now updates at a 15-second interval and formats the date only when the local date changes.
- Independent Enterprise chat-history and reminder-preference startup requests now run concurrently.

## Loading and caching
- Chart.js is loaded only when Analytics is first opened in either experience.
- Enterprise confetti is loaded only after a task is completed for the first time.
- Versioned Classic CSS/JavaScript assets use long-lived immutable browser caching.
- Application HTML uses a short cache lifetime with stale-while-revalidate so it can be refreshed promptly after deployment.
- Service worker shell cache namespace updated to `nexos-shell-v4`.
- Reduced expensive ambient/glass filtering on small Enterprise screens while preserving the desktop visual treatment.

## Preserved
- Classic and Enterprise experiences and routes.
- Existing API contracts, MongoDB collections, user records and workspace format.
- Existing authentication, Google sign-in, guest mode, shared Classic/Enterprise workspace data, AI APIs, reminders, PWA and settings flows.
- No database reset or data migration is required.

## Verification
- Run `npm test` before deployment.
- Run `npm run lint` where ESLint is available.
- Verify sign-in, Classic and Enterprise startup, Analytics, settings, task persistence, reminders, AI and mobile layouts in the deployed browser.
- Browser-level performance measurements are not included in this source build; compare DevTools Network and Performance traces on the actual deployment and target devices.
