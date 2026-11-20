# NexOS 3.4.2 — NexAI Stability & Latency

## Stuck Gemini requests
- A Gemini request that has not started answering within 15 seconds is now retried, then sent to the fallback model. Before, one stuck connection held a chat for the full 45-second timeout (a 48-second reply that the retry answered in 1.8 seconds).
- The limit can be changed with the optional `GEMINI_FIRST_TOKEN_TIMEOUT_MS` environment variable (3000–60000). Messages with attachments wait up to 40 seconds.
- Network and stream failures on the primary model now fall through to the fallback model instead of stopping.
- A partly delivered answer is still never restarted, so text is not duplicated.

## Fewer database waits
- The sign-in check result is remembered for 20 seconds. It is cleared on sign-in, rename and data deletion, so signing other devices out still works within that time.
- Existing chats read only the recent messages that are sent to Gemini, instead of the whole saved history.

## Diagnostics
- `[NexAI timing]` now also reports `streamed`, `authCached` and `firstTokenTimeouts`.

## Preserved
- Streaming, creator identity safeguards, attachments, greeting fast path and existing chat data.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v20`), Docker label and release tests are all at 3.4.2.
