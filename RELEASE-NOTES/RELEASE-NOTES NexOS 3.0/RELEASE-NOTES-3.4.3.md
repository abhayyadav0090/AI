# NexOS 3.4.3 — NexAI Chat Recall

## Asking about earlier messages
- Normal messages still send only the last 24 messages to Gemini, so they stay fast.
- When a message asks about earlier messages (for example "what was my first message?", "what did we discuss yesterday?", "pehla message kya tha?"), the saved chat is read in full for that one request and sent to Gemini within a size limit (about 60,000 characters; very long messages are shortened).
- Recall works inside the current chat only. A chat keeps at most 200 messages.

## Honest answers about what NexAI can see
- Each request now tells NexAI how much of the chat it can see. If something older is not visible, NexAI says so plainly and suggests asking for a look-back, instead of blaming a reset, cache or memory problem or guessing what the messages said.

## Sign-in check
- The remembered sign-in check now lasts 60 seconds (was 20). It is still cleared on sign-in, rename and data deletion.

## Diagnostics
- `[NexAI timing]` now also reports `recall`.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v21`), Docker label and release tests are all at 3.4.3.

## Preserved
- Streaming, first-token retry and fallback, creator identity safeguards, attachments, greeting fast path and existing chat data.
