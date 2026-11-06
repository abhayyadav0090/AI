# NexOS 3.0.1 — Speed & Responsiveness

A focused maintenance release based on real Android screen-recording observations.

- Paints the Classic and Enterprise workspace from the matching account-scoped local cache before the network refresh completes.
- Reconciles cached changes with the authenticated server workspace and preserves pending offline edits.
- Updates Enterprise greeting, dashboard summary and KPI counters from the same cached workspace snapshot.
- Keeps Recently Deleted inside the current experience, preserves its theme, and returns to the same route.
- Reduces expensive mobile blur and ambient-animation work while retaining the desktop visual treatment.
- Adds authoritative workspace update timestamps to bootstrap and state API responses.

No database reset or workspace migration is required.
