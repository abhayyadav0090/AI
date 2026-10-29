# NexOS 2.5.2: habits can no longer be deleted by a mis-tap

## Fixed
- **Enterprise, phone: habit rows overlapped and the delete button sat on top of today's check.** The row forced a 240 px name column, seven day buttons and the delete button into one line. On a phone the day buttons were squeezed over each other and the small ✕ landed on the last one, so ticking today could delete the habit. On phones each habit is now two lines: the name and streak with a separate, larger delete button at the top, and the seven days in their own row below it. Checked on 390, 360 and 320 px, a tablet and a laptop.
- **Deleting a habit was instant and permanent.** It now asks first (naming the habit and how many check-ins go with it) and then shows an **Undo** message for 9 seconds. Deleting a task also shows Undo.
- Every screen in Enterprise was scanned at 360 px for other buttons that overlap; none were found.

## Added
- **`/recover.html`: a page to bring back a deleted habit.** It looks through the copies of your data that this browser keeps, lists habits that are no longer in your account (with how many days were ticked and the last day), and restores the one you choose with its whole history. It only adds habits and never changes or deletes anything else. It can only find what this browser still has, so use the same phone or browser where it was deleted, and do not open Classic first (Classic refreshes its copy). A backup file from Export also holds your habits.
