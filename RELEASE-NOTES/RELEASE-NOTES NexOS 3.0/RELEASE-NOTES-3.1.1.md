# NexOS 3.1.1 — Faster PWA Startup

NexOS 3.1.1 is a focused mobile/PWA startup maintenance release. It keeps the existing Classic and Enterprise experiences, account data, authentication and Recovery Center behaviour intact.

## Changes
- **Instant app-shell reuse.** The service worker precaches the Classic shell during installation and serves cached app-shell HTML immediately while checking for an updated copy in the background.
- **Cache-first static assets.** The Classic versioned JavaScript, styles and app icons in the shell cache are served before the network. Versioned assets remain immutable for the lifetime of their versioned URL.
- **Parallel Classic script downloads.** The Classic push client, application logic and UI scripts use `defer`, preserving execution order while allowing downloads to happen in parallel.
- **Correct versioned cache headers.** The server now recognises semantic-version query strings instead of only `v=3.0.0`.
- **Private data stays private.** `/api/` requests, including authentication and workspace bootstrap/state, are never cached by the service worker.

## Preserved
- Classic and Enterprise features, layouts, themes and account/workspace data.
- Google authentication, guest mode, NexAI, reminders and push notifications.
- Recovery Center (`public/recover.html`) is unchanged.
- No database migration or environment-variable change is required.

## Verification
- Run `npm test` before deployment.
- After deployment, open the installed NexOS app once while online to install the updated service worker and precache the app shell. Close and reopen it to verify the cached shell appears promptly.
- Browser-level startup timing still needs confirmation on the target Android phone; this source-only test cannot measure the device's actual launch splash duration.
