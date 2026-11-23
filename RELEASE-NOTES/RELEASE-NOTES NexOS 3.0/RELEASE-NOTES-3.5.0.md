# NexOS 3.5.0 — NexAI Chat: Habits and Notes

## New
- **Add habits:** when NexAI suggests habits or a routine, an **Add N habits** button appears (N is however many it listed, one is enough). "add these habits" / "inhe habits mein add karo" adds them directly. A habit with the same name is skipped.
- **Save as note:** longer NexAI replies get a **Save as note** button. "save this as a note" / "isse note mein save karo" saves the last reply directly (title from its first heading or line, tag `nexai`).
- Everything has Undo and works in Classic, the Enterprise NexAI page and the Enterprise side dock.

## Tasks vs habits (no guessing)
- The reply and your message decide: words like habit, routine, streak, roz mean habits; task, to-do, due, deadline mean tasks. "add these habits" or "add these tasks" always wins.
- If it could be either, nothing is added until you tap **As tasks** or **As habits**.
- One item is now enough for the tasks button too, when the reply or your message makes clear they are tasks.

## Unchanged
- Fresh requests such as "create 3 tasks for my portfolio" still go to NexAI. Action Mode, Classic layout, themes and the Recovery Center are untouched.
- The direct-add confirmation is shown on screen only and is not saved in chat history.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v28`), Docker label and release tests are all at 3.5.0. New test `scripts/test-chat-actions-350.js`; `public/chat-tasks.js` now covers tasks, habits and notes.
