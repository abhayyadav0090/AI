# NexOS 2.5.3: Recently deleted

## Added
- **Recently deleted (30 days).** When you delete a task, habit or note in Classic, or a task or habit in Enterprise, a copy is kept in your account for 30 days (up to 30 items). Open **Recently deleted…** in Classic's Settings (Your data) or Enterprise's gear menu. It opens `/recover.html`, which lists what you deleted, newest first, with a Restore button for each. Restoring puts the item back exactly as it was, with a habit's whole history. After restoring, reload NexOS.
- The copy follows your account, so it works from any device, and it is cleaned up automatically: older than 30 days, malformed, oversized (60 KB each) and duplicate entries are dropped.
- Undo (the message after deleting) also takes the item out of the list again.
- The page still shows older habit copies found in your browser, as in 2.5.2.

## Notes
- Items deleted before this version are not in the list.
- Guest mode keeps its data only in the browser and has no Recently deleted page.
