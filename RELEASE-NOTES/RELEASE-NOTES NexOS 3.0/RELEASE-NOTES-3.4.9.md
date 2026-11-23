# NexOS 3.4.9 — Add NexAI's Suggested Tasks in One Tap

## What changed
- When NexAI replies with a list of tasks, an **Add N tasks** button appears under that reply. One tap adds them to To Do, with an Undo toast.
- Typing a short command right after such a reply, like "add these tasks", "ye tasks add kar do" or "inhe add karo", adds them **directly**. This does not call NexAI, so it is instant and uses no AI quota.
- Works in Classic NexAI chat, the Enterprise NexAI page and the Enterprise side dock (Ask NexAI).
- Duplicates are skipped (a task with the same title that is not done yet). Priority and due date are picked up when the reply states them (for example "high priority", "due 2026-11-25", "tomorrow").
- A fresh request such as "create 3 tasks for my portfolio launch" still goes to NexAI as before; Action Mode is unchanged.

## Notes
- The direct "add these" confirmation is shown on screen only and is not saved in the chat history.
- New shared file `public/chat-tasks.js` (also precached by the service worker). New test `scripts/test-chat-tasks-349.js`.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v27`), Docker label and release tests are all at 3.4.9.

## Preserved
- Classic layout, Action Mode, the Recovery Center, themes and workspace data are untouched.
