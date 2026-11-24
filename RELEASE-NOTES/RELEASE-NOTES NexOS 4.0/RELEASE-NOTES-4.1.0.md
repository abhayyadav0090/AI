# NexOS 4.1.0 — Study Studio

## New
- **Study Studio:** a button on the Classic dashboard ("Study Studio") and in the Enterprise dashboard and quick actions. Upload a text PDF, TXT or Markdown file (up to 4 MB), then ask NexAI to explain a concept, solve a problem step by step or check your understanding, **from your own material**.
- **Page references:** each answer lists the document and page (or heading) it used, for example `Biology ch 2 · p. 4`.
- **An honest "not found":** when your material does not contain the answer, NexAI says so instead of guessing. If nothing in your notes matches the question, no AI call is made at all.
- **Library:** each user can keep up to 20 documents and 1,500 sections, delete any document (its sections are deleted first), and scope a question to one document or to everything.
- **Guest sample:** guests see a scripted example of a question and a cited answer, make no request, and end on a Sign in button, like the 4.0.0 samples.

## How it works
- The server reads the file inside the upload request and keeps only its **text**, split into sections of up to 1,200 characters that never cross a page. The original file is not stored.
- Questions are matched against your sections with a MongoDB text index (word matching, no embeddings), so there is **nothing new to set up in Atlas** and no extra Gemini quota is used for uploads.
- The best 6 sections go to Gemini with instructions to answer only from them, treat them as data, cite them like [1], and reply NOT_FOUND when they are not enough.

## How it stays safe
- Every study route needs the login cookie and filters by the user id from the cookie, never from the request body. Another user's document id answers 404, and a search cannot leave your own sections.
- The file type comes from the real bytes, not the name or the browser. Password-protected, damaged and scanned (image-only) PDFs are refused with a clear message.
- Uploads have their own body limit (6 MB), their own rate limit (12 per hour per user), a one-file-at-a-time reader, a page limit (300) and a time limit (25 seconds). Duplicate files are refused.
- Answers are escaped before they are shown. Deleting your workspace data (`DELETE /api/me`) now also deletes your study documents and sections.

## Limits to know
- Scanned PDFs, DOCX and PPTX are not supported yet, and the original files are not kept.
- Search matches words, not meaning. A question that shares no words with your notes may say "not found"; try the words your notes use. Embeddings and Atlas Vector Search are the planned upgrade.
- No quizzes, flashcards, progress tracking or revision schedule yet (planned for later releases).
- `pdfjs-dist` is pinned to 3.11.174 (CommonJS build). It is used only to extract text, with script evaluation turned off; moving to a current pdf.js is a good follow-up.

## Documentation
- `mds/API.md`: the four `/api/study` routes, error codes, limits and a 4.1.0 change note.
- `mds/ARCHITECTURE.md`: Study Studio section with a diagram, the two new collections, limits and scaling notes.
- README: feature, tech stack, structure, API overview, privacy, known limits and release history.

## Files
- New: `lib/study.js`, `public/study.js`, `scripts/test-study-410.js`, this file.
- Changed: `server.js` (router, upload limit, account deletion), `public/app.js`, `public/index.html`, `public/index-redesign.html`, `public/sw.js` (cache `nexos-shell-v30`, precaches `study.js`), `public/contact.html`, `package.json`, `package-lock.json`, `docker-compose.yml`, README, `mds/API.md`, `mds/ARCHITECTURE.md`, and the version strings in six older tests plus `test-derail-400.js`.
- Not touched: Classic and Enterprise layouts and themes, NexAI chat, Action Mode, Day derailed, the Recovery Center.

## Version
- Package, lockfile, README, asset versions, service worker cache, Docker label and release tests are all at 4.1.0. `npm test` also syntax-checks `public/study.js` and `lib/study.js` and runs `scripts/test-study-410.js`.
