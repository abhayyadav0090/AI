# NexOS 2.3.1 — Enterprise-first polish

- Enterprise NexOS is now the default home route (`/` redirects to `/enterprise`). Classic remains available at `/classic`.
- Added a visible Classic/Enterprise experience switch on the Classic top bar and kept both options visible in Enterprise.
- Made the Overgame (cyber-aubergine) theme the one-time default for existing and new Enterprise workspaces; future theme selections are preserved.
- Fixed the Enterprise profile card opening the command palette; it now opens a profile dialog with account/workspace status.
- Fixed mobile sidebar layering and removed backdrop blur that made the screen appear blurred; the drawer now sits above the dimming backdrop and exposes its expanded state.
- Dashboard greeting now uses the signed-in user's name, or Guest in guest mode.
- Kept the Spacious density option and existing task-alert controls unchanged.
- Classic and Enterprise continue to use the existing NexOS backend; no new environment variables are required.
