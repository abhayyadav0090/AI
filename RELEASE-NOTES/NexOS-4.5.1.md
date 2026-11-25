# NexOS 4.5.1 — Study Studio Integration & NexAI Reliability Patch

## Study Studio Integration
- **Google Calendar & `.ics` exam revision time-blocks:** Exam plans now generate daily topic-balanced revision time-blocks via `GET /api/study/plans/:id/schedule` and `GET /api/study/plans/:id/calendar.ics`, with zero-config Google Calendar event creation, `.ics` download, adding today's revision block directly to NexOS Tasks / Timeblocking Studio, and optional direct Google Calendar API OAuth sync (`/api/study/calendar/*`, AES-256-GCM encrypted refresh tokens).
- **Habits study streak & daily goals:** Study Studio syncs with the Habits tracker (`Daily Study & Revision` or an existing study habit), displaying current/best streak and daily target, and automatically checks off today's study habit when spaced revisions, quizzes, or flashcard decks are completed.
- **Spaced revision push notifications:** The Web Push reminder scheduler (`lib/study-reminders.js`) checks due `StudyReview` items and sends a consolidated `NexOS Study Revision` push alert that opens Study Studio directly on the Revision tab (`/?study=revision`).
- **Automatic next due date scheduling:** Rating a revision item computes the next due date at the start of the target day in the user's time zone, deduplicates repeated topics in the queue, and surfaces upcoming scheduled revision dates in the Revision tab.

## NexAI Reliability Fixes
- **Automatic `MAX_TOKENS` continuation & overlap deduplication:** `askGeminiStream` and `askGemini` now capture `MAX_TOKENS` instead of discarding it, and `lib/nexai-reliability.js` automatically continues boundedly while stripping duplicated words, lines, and paragraphs before streaming to the client.
- **Partial response preservation & Continue UI:** Stream interruptions or incomplete responses preserve received text on both Classic and Enterprise (including the Enterprise side dock), display an explicit incomplete-response banner with a one-click **Continue** action, and persist `incomplete` / `incompleteReason` in MongoDB chat history.
- **Conversation memory on Continue:** Saying "continue" strips any prior cutoff notice from model history, instructs Gemini to resume seamlessly without repeating, and filters overlap against the previous partial message.
- **Complete-only Note saving & stricter Task extraction:** `Save as note` is withheld and blocked on incomplete responses; task extraction ignores code blocks, blockquotes, metadata labels (`Hook:`, `CTA:`, `Hashtags:`, `Tip:`), and truncated trailing fragments, extracting only clear actionable tasks.
- **Honest error diagnosis:** NexAI no longer deflects bug or truncation reports to GitHub by default; it diagnoses and explains the technical cause directly in chat and helps continue or recover.
