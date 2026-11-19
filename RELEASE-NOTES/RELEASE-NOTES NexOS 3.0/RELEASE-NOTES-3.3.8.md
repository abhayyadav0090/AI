# NexOS 3.3.8 — Clickable Links & Rich Chat Rendering

Focused frontend refinement so links in NexAI chat responses behave like links in modern chat interfaces.

## Changes
- **Clickable Markdown links:** renders `[label](https://...)` as an actionable link.
- **Internal navigation:** supports safe same-site absolute paths such as `/contact.html`.
- **Bare URL support:** automatically links plain `https://...` URLs even when NexAI does not wrap them in Markdown.
- **Readable link presentation:** adds visible underline, hover, and keyboard-focus styling.
- **Safe rendering:** model output remains HTML-escaped; only supported URL schemes are rendered as links. External links open in a new tab with `noopener noreferrer`.
- **Regression coverage:** adds tests for Markdown links, internal paths, bare URLs, unsafe schemes, HTML escaping, and inline code.
- **Cache/version refresh:** updates app asset versions and service-worker cache to v16.

## Verification
Run `npm test`, then ask NexAI for its Contact Page. Confirm the named link is clickable and opens the page in a new tab. Also test a plain URL and an internal `/contact.html` link.

## Unchanged
- NexAI creator identity and public/private contact safeguards from 3.3.7.
- Contact page content, database, environment variables, Classic and Enterprise layouts, themes, and Recovery Center.
