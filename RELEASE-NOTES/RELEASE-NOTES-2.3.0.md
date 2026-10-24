# NexOS 2.3.0 — Dual Experience

This release preserves Classic NexOS as the default `/` route and adds Enterprise NexOS at `/enterprise` (also `/redesign`). Both experiences use the same authenticated MongoDB workspace through the existing `/api/state` endpoint. Enterprise tasks, habits, notes, and focus logs are mapped to Classic's canonical fields so edits appear in both views.

## Included
- Classic/Enterprise experience switch in both interfaces.
- Account-scoped Enterprise UI preference cache; no shared unscoped cache is used for signed-in accounts.
- Guest Enterprise workspace is shared with Classic guest state on the same browser.
- Enterprise NexAI chat and history use `/api/chat` and `/api/chats`.
- Action Mode proposals use `/api/complete`, are limited to creating tasks/notes, and require explicit user approval.
- Enterprise task alert controls use `/api/push/preferences`; push subscription/testing use the existing push client and VAPID setup.
- Existing audited backend fixes, auth, and deployment files retained from 2.2.1.

## Deployment
No new environment variables are introduced. Keep the existing Render secrets. The default `/` route remains Classic NexOS; `/enterprise` opens the new UI.

## Important behavior
- Signed-in users sync to the existing MongoDB `UserState` document through `/api/state`.
- Guest mode stores shared task/habit/note data only in this browser, using the existing guest state key.
- An unauthenticated preview uses sample data locally and never pushes it to an account.
- The Sample Data action confirms before replacing a non-empty workspace, including the shared signed-in workspace.
- Live NexAI and Action Mode require a Google-authenticated account, matching Classic NexOS access rules.
