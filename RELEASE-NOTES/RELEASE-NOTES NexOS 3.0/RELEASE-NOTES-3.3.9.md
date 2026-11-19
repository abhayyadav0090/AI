# NexOS 3.3.9 — Enterprise Chat Link Rendering Fix

## Fixed
- Enterprise NexAI chat now renders Markdown links as real clickable anchors, matching Classic mode.
- Corrects the malformed nested-link syntax observed in Enterprise responses.
- Plain absolute URLs and same-site links are clickable.
- External links open in a new tab with `noopener noreferrer`; unsafe URL schemes remain blocked.
- Preserves existing note Markdown formatting and escapes untrusted HTML.

## Scope
Focused Enterprise renderer fix. No changes to Classic chat behavior, workspace data, authentication, or creator identity/privacy rules.
