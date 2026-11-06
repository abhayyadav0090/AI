# NexOS 2.5.8: Focus on a task

## Added
- **Focus on a task (Classic and Enterprise):** Each open task on Home and in the Kanban board has a play button. It moves a To Do task to In Progress, starts a focus session, and shows "Focusing on <task>" above the timer on Home and on the Focus screen.
- **Finish prompt:** When a focus session ends, NexOS asks "Done with it?" with Mark done or Keep going. Keep going leaves the task selected for the next session.
- **Time per task:** Home and Kanban cards show the focus minutes spent on a task (for example "25m focused").

## Notes
- The selected task lives only in the tab you are using. It is never synced, so two tabs cannot fight over it.
- Focus time is stored on each logged session, not on the task. Sessions merge across tabs and devices like they already did, so minutes add up instead of overwriting each other.
- A running or paused timer must be reset before you start focus on a different task.
- Deleting a task clears the selection. Minutes logged for a deleted task still count toward your totals, but no longer show on a task.
