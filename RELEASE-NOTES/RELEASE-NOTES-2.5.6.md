# NexOS 2.5.6: Stale-tab guard for the quick-start

## Fixed
- If two screens are open on a brand-new account and you answer the quick-start on one, then edit or delete a starter item, answering on the other screen no longer brings the old starter items back or overwrites your edit. Classic checks the account first and uses the existing setup. Enterprise takes the account's version of each starter item.

## Notes
- Edits and deletions made after the first sync were already safe: Enterprise merges changes three ways, so a stale tab cannot overwrite them.
- Dashboard card order uses CSS `order` only. No card depends on its position, so no spacing or height rules change.
