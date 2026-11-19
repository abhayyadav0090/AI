# NexOS 3.4.1 — NexAI Performance Optimization

## NexAI streaming and latency diagnostics
- Added incremental Gemini `streamGenerateContent` responses for Classic and Enterprise chat.
- Added first-token, total Gemini, retry-count, model, and database timing diagnostics without logging prompts or workspace content.
- Preserved the existing JSON response path for older clients and the local greeting fast path.
- Retries are limited to failures before any response text is delivered; a partially delivered answer is never restarted and duplicated.

## Context and database efficiency
- Reduced Gemini conversation history from 40 to 24 recent messages; older messages remain saved in chat history.
- Bounded workspace summaries to reduce repeated prompt payload size.
- Chat pruning now runs only when a new conversation is created, rather than on every message.

## Schedule time accuracy
- Schedule prompts now include the browser's actual local date, time, IANA timezone, and UTC offset.
- The planner is instructed never to schedule in the past or invent earlier time slots after 22:00 local time.
- Explicitly unscheduled items remain unscheduled during client-side validation.

## Preserved
- NexAI creator identity and contact safeguards.
- Existing MongoDB chat history and workspace data.
- Attachments, greeting fast path, and non-streaming API compatibility.
