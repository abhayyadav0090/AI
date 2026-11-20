# NexOS 3.4.4 — NexAI Look-back Follow-ups

## Better detection of look-back questions
- Messages such as "correct, second messages", "we discussed", "hamne kiske baare mein discuss kiya tha" or "my second question" now also read the saved chat, even without words like "first" or "yesterday".
- Ordinary requests such as "let's discuss React hooks" or "explain a message queue" still use the fast path.

## Follow-ups keep the look-back
- After an explicit look-back question, the next messages in the same chat stay in look-back mode for two minutes, so replies like "wrong", "try again" or "you missed one" are answered from the full chat. Only an explicit question extends the window, so a burst of unrelated messages returns to the fast path.

## Honest explanations
- NexAI is told never to claim it checked logs, caches or deeper history. If asked why an earlier answer was wrong, it says it was answering from the messages it could see at that time.

## Version
- Package, lockfile, README, Classic and Enterprise asset versions, service worker cache (`nexos-shell-v22`), Docker label and release tests are all at 3.4.4.

## Preserved
- Streaming, retries and fallback, 60-second sign-in cache, creator identity safeguards, attachments, greeting fast path and existing chat data.
