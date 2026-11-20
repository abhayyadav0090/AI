# NexOS 3.4.5 — NexAI Stall Recovery and Lean Look-back

## Stalled streams no longer lose the reply
- A real 3.4.4 request got its first token in 0.9 s, then hung for 45 s and ended with "stream was interrupted"; nothing was saved.
- After the first token, 12 s of silence (`GEMINI_STREAM_IDLE_MS`) now ends the stream. The text already received is kept, a short "cut off, say continue" note is added, and the turn is saved so the chat history stays consistent. Timing logs show `partialReply` and `streamIdleTimeouts`.
- Before the first token, the existing retry and fallback model behaviour is unchanged.

## Look-back window only for follow-ups
- The two-minute window after an explicit look-back question now applies only to messages that sound like follow-ups ("wrong", "try again", "why?", "you missed one"). Keyboard smashes and new topics inside the window use the fast 24-message path instead of reading the whole chat.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v23`), Docker label and release tests are all at 3.4.5.

## Preserved
- Explicit look-back detection, honest history-scope note, streaming, retries and fallback, 60-second sign-in cache, creator identity safeguards, attachments and existing chat data. Classic and the Recovery Center are untouched.
