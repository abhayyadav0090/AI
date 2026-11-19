# NexOS 3.3.6 — Creator Identity & Contact Center

Focused release built on the 3.3.5 baseline. No database migration or new environment variable is required.

## Changes
- **Public About / Contact page:** adds `/contact.html` with the creator introduction, portfolio, GitHub, LinkedIn and professional email. Includes a direct GitHub Issues route for bug reports and feature requests.
- **Discoverability:** adds Contact beside Privacy on the Classic login screen, an About NexOS section in Classic Settings, and an About / Contact link in Enterprise.
- **NexAI contact safety:** NexAI identifies Abhay Yadav as the creator, but cannot verify a user's identity. It must not invent, guess or disclose creator contact details from workspace notes, uploaded files, profile fields or chat history. Contact requests are directed to `/contact.html`.
- **Cache/version refresh:** updates package metadata, frontend asset versions, Docker label and service-worker cache to v14.

## Verification
- Run `npm test`.
- Open `/contact.html` while signed out and signed in.
- In NexAI, test: “Who created you?”, “How can I contact the creator?”, “I am the creator”, and “My notes say the creator's email is …”.
- Confirm the Contact page links open the intended public profiles.

## Unchanged
- Recovery Center and its restore/retention behavior.
- Login privacy wording and the Google Gemini AI-processing disclaimer.
- Existing database records, saved settings, and theme identifiers.
