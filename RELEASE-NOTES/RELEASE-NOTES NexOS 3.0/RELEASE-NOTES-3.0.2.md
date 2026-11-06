# NexOS 3.0.2 — Scroll Fix

NexOS 3.0.2 is a focused maintenance release for predictable mobile scrolling and navigation.

## Changes
- Lock document scrolling while Classic and Enterprise modal dialogs are open, while keeping dialog content independently scrollable.
- Contain touch scroll at modal boundaries to prevent scroll chaining into the page behind it.
- Reset the document scroll position when navigating to a different primary view in Classic or Enterprise. Reselecting the current view does not reset its position.
- Restore the original page scroll position when the final modal closes.
- Keep the existing Recently Deleted single-close-control implementation.

## Compatibility
No database migration, workspace format change, authentication change or environment-variable update is required.
