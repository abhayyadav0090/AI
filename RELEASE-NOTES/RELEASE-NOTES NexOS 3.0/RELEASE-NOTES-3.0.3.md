# NexOS 3.0.3 — Recovery Center

NexOS 3.0.3 redesigns the Recently Deleted panel. Only `public/recover.html` changed in the app; Classic and Enterprise are untouched.

## Changes
- **One Close control.** The panel no longer draws its own blue Close button on top of the grey one that Classic and Enterprise already show. Pressing Esc also closes it.
- **Its own design.** Recovery now has a separate graphite-and-emerald look, with light and dark themes that follow the app.
- **Emerald Restore buttons.** Restore is emerald in both themes, with larger touch targets. After a restore the card dims and shows "Restored".
- **Clearer cards.** Each item shows a type icon and badge (Task, Habit, Note), when it was deleted, and how many days are left before it is removed. Items with three days or fewer are highlighted.
- **Better header and empty state.** A new header with a short retention note, and an empty state that explains what will appear here.
- **Mobile layout.** Cards stack with a full-width Restore button, safe-area padding, and no overlap with the host's Close button.

## Unchanged
- Restore behaviour, 30-day retention, the "Found in this browser" habit copies, and the refresh after a restore.
- No database migration, workspace format change, authentication change or environment-variable update is required.
