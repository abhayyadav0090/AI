# NexOS 2.5.4: Quick-start

## Added
- **"What will you use NexOS for?"** A new workspace now asks once, with four choices: study and exams, projects and sprints, daily routine and habits, or just exploring. Skip is always available.
- The choice sets three things: the starter sample tasks, habits and note, the default focus timer (study 50/10/20, projects 25/5/15, habits 15/3/10, exploring 25/5/15 minutes), and the order of the sections on Classic Home.
- Change it any time in Classic: Settings, then **Your setup**, then **Change...**. Re-running only changes the focus timer and Home order. Your tasks, habits and notes are not touched.
- Enterprise shows the same question on its dashboard for a brand-new empty workspace. It adds the same starter items and sets the focus timer. A goal chosen in Classic also sets the Enterprise focus timer once; after that, your own timer settings win.
- The choice is saved in your account as a small `profile` setting, so Classic and Enterprise share it.

## Notes
- Existing accounts do not see the question. They can open it from Classic Settings.
- Closing the tab before answering does not lose it: a new workspace stays unseeded until you answer or skip.
- Home section order is a Classic feature. Enterprise keeps its own dashboard layout.
- No server change is needed. `/api/state` already stores the whole state.
