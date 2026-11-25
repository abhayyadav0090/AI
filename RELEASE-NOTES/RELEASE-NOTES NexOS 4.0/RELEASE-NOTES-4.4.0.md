# NexOS 4.4.0 — Study Studio, part 2

## Better answers
- **Small notebooks are answered from the whole material.** If your chosen material is up to about 80,000 characters (roughly 65 sections), NexAI reads all of it, so a question that shares no words with your notes ("what captures sunshine?" for notes about chlorophyll) still gets an answer. Before, it said "not found".
- **Larger material is searched, with a second try.** When the first keyword search finds fewer than two sections, NexAI asks Gemini for related keywords once and searches again. If that extra call fails, the answer carries on without it.
- **Tap a source chip to read the passage** it used (up to 600 characters), not just the page number.
- The tutor still answers only from your material and still says "not found in your material" when the answer is not there.

## Quiz tab
- Choose the material (all or one document), how many questions (3, 5, 8 or 10), the level (easy, medium, hard) and an optional topic.
- Multiple choice with four options. Tap an answer to see right or wrong at once, an explanation and the page it came from. Options are shuffled on the server.
- At the end: your score, the questions you missed with their answers, and **Retry the ones I missed**.

## Cards tab
- 5, 10, 15 or 20 flashcards from your material (or one topic). Tap a card to flip it, then **Got it** or **Again**. At the end, review only the cards you missed.

## Good to know
- Quizzes and cards are written by Gemini from your material, so check an answer you doubt against its source chip.
- Each tutor answer, quiz or deck is one Gemini call (a keyword-search answer can be two) and counts toward the same per-user limits and your free Gemini quota.
- Quiz and deck progress is kept in the dialog only and is not saved.

## Under the hood
- `lib/study.js`: whole-material mode, keyword expansion, `POST /api/study/quiz` and `POST /api/study/flashcards`, with strict validation of the model's JSON. `public/study.js`: Quiz and Cards tabs and tappable sources. No new collections, no new dependencies.
- `scripts/test-study-410.js` now pins keyword-search mode for its checks; the new `scripts/test-study-440.js` covers the rest.

## Unchanged
- Upload limits and formats, the Library tab, guests (they still see the scripted sample), Day derailed, habits, the sidebars and the Recovery Center.

## Version
- Package, lockfile, README, asset versions, service worker cache (`nexos-shell-v36`), Docker label and release tests are at 4.4.0.
