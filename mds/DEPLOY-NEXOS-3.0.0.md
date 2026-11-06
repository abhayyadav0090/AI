# Deploy NexOS 3.0.0 to the existing Render service

This release does not require a database reset, data migration, or new environment variables.

## Before deploying

1. Keep the existing NexOS Render web service and connected GitHub repository.
2. Replace the repository contents with the contents of this release, keeping the project files at the same repository root.
3. Keep the existing Render build command, start command, region, health-check configuration, and environment variables unchanged. The project continues to support `npm install` and `npm start` (`node server.js`).
4. Do not delete or recreate the MongoDB database or collections.

## Deploy

1. Commit and push the updated project to the branch connected to the existing Render service.
2. Let Render deploy the new commit, or use **Manual Deploy → Deploy latest commit**.
3. Check the deployment logs for a successful dependency install and successful NexOS server startup. The app's server should start with the existing `npm start` command.
4. Open the Classic route (`/`) and Enterprise route (`/enterprise`) after the deployment completes.

## Post-deploy smoke checks

- Sign in with the existing Google account.
- Confirm existing tasks, habits, notes, settings, and workspace data are present.
- Open Classic and Enterprise and switch between the two experiences.
- Open Analytics in both experiences to confirm charts load on demand.
- Open Settings, change a harmless preference, refresh, and confirm it persists.
- Check NexAI, reminders, push permissions, and PWA installation.
- Test on a desktop and a mobile-sized viewport.

## Rollback

If a production issue appears, use Render's deploy history to redeploy the previous known-good commit. Do not restore an old database snapshot unless there is an independently confirmed data-corruption event; this release does not intentionally change the stored workspace format.
