# NexOS 4.1.2 — Study Studio in the sidebars, one shortcut order

## Changed
- **Classic:** Study Studio now has its own entry in the left sidebar (book icon, just above NexAI). It opens the same Study Studio dialog and closes the sidebar first on phones.
- **Enterprise:** the sidebar and the shortcuts now follow one order: Dashboard `Alt+1`, Kanban Board `Alt+2`, Deep Focus `Alt+3`, Habit Mastery `Alt+4`, Smart Notes `Alt+5`, Analytics `Alt+6`, Timeblocking `Alt+7`, **Study Studio `Alt+8`**, NexAI `Alt+9`. Timeblocking used to sit third in the list while showing `Alt+8`; the labels are now in order too.

## Unchanged
- Study Studio and Day derailed dialogs, the server and its API, Classic's own Alt+1 to Alt+7 view shortcuts, and the Recovery Center.

## Version
- Package, lockfile, README, asset versions, service worker cache (`nexos-shell-v32`), Docker label and release tests are at 4.1.2. New test `scripts/test-sidebar-412.js`.
