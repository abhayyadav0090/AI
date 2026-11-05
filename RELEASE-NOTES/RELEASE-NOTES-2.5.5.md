# NexOS 2.5.5: Quick-start on Enterprise

## Added
- **Enterprise dashboard order.** The four dashboard cards now follow your goal, the same way as Classic Home: study puts Focus first, projects puts Tasks first, habits puts Habits first, exploring keeps the default order.
- **Enterprise Settings: Your setup.** The gear menu has a goal picker. Changing it updates the focus timer (unless a session is running) and the dashboard order. Your tasks, habits and notes are not touched, and the change also applies in Classic.

## Fixed
- **No duplicate starter items.** Starter tasks, habits and the welcome note now have fixed ids. If Classic and Enterprise are open in two tabs and both seed a new workspace, they merge into the same items.

## Notes
- The existing `seeded` flag plus the empty-workspace check already act as the seeding lock, so no extra flag was added.
