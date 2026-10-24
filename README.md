# NexOS 2.3.2 — Dual Experience Workspace

NexOS offers two interfaces over the same authenticated workspace and backend:

- **Enterprise NexOS** is the default route (`/`) and is also available at `/enterprise` and `/redesign`.
- **Classic NexOS** is available at `/classic`; its top bar includes the experience switch.

Both experiences use the existing MongoDB-backed `/api/state` endpoint for shared tasks, habits, notes, and focus history. Google sign-in, NexAI chat, Action Mode proposal endpoints, and reminder preferences remain on the existing backend.

## Deploy on Render

1. Extract the ZIP and open the `AI-main` folder.
2. Replace the contents of your NexOS GitHub repository with the **contents** of `AI-main` (keep `server.js`, `package.json`, and `public/` at the repository root).
3. Commit and push the changes.
4. Resume the Render service when you're ready, then deploy the latest commit.

Keep your existing Render environment variables and MongoDB configuration. This build does not require a new secret. The app supports `MONGO_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`, `GEMINI_MODEL`, optional `GEMINI_FALLBACK_MODEL`, `ALLOWED_ORIGINS`, and the existing VAPID variables.

## Reminder behavior

Reminder time, enabled/disabled state, and time zone are stored separately from workspace data. The background job checks subscribed users only, and checks every five minutes; an alert can arrive a few minutes after the selected time. As with any in-process scheduler, notifications can be delayed while a Render instance is suspended or asleep.

## Tests

Run `npm test` for JavaScript syntax checks and Enterprise adapter checks. Browser, real Google sign-in, live MongoDB writes, Gemini calls, and push delivery still require a deployed/service-backed test.
