# NexOS 2.3.2 — Cloud reliability improvements merged

This release is based on the 2.3.1 dual-experience build and selectively adopts the reliable improvements from the supplied Cloud 2.2.0 build.

- Preserves Enterprise-first routing and the `/classic` route, including the Enterprise theme migration and profile/mobile navigation fixes.
- Replaces the Classic interface assets with Cloud's improved responsive UI: Google Material / Microsoft Fluent selection, light/dark/system theme controls, task list view, command palette, undo snackbars, note autosave, sync status, and keyboard shortcuts.
- Adds a visible Classic/Enterprise experience switch to the Classic top bar.
- Adds per-user reminder time-zone storage and validation; India time remains the default.
- Reduces background reminder database work by only loading workspaces for users with NexOS push subscriptions.
- Corrects VAPID private-key leading-zero padding edge cases.
- Invalidates old NexOS sessions after a user deletes their workspace data, while retaining the shared Google identity record as described in the privacy UI.
- Adds explicit API origin rejection, same-host allowance behind a proxy, static ETags/cache headers, JSON 404s for unknown API routes, and consistent JSON errors.
- Removes `unsafe-eval` from the CSP, adds worker/manifest CSP sources, improves health diagnostics, and reports missing runtime configuration at startup.
- Improves service-worker cache cleanup and waits for cache writes, while leaving API requests out of the offline cache.

## Validation

`npm test` checks JavaScript syntax (including the Classic UI module) and the Enterprise inline adapter. Additional integration checks are run while packaging. Live Render, Google OAuth, MongoDB, Gemini, and Web Push delivery must still be verified in the production environment.
