# NexOS 3.3.5 — NexAI Identity and Neutral Theme Names

Small release. No layout change and no change to the Recovery Center.

## Changes
- **NexAI identity.** The server now gives every AI request a short identity note: NexAI is the NexOS assistant, created by Abhay Yadav. Asked who made it, NexAI no longer names another company. The Classic chat prompt says the same.
- **No "powered by Google Gemini" in the welcome message** (Classic and Enterprise) or the page description. The login screen text about Google sign-in, and the AI disclaimer, are unchanged.
- **Neutral theme names.** Enterprise: Glass, Midnight, Daylight, Tonal, Overgame, Cobalt Lime. Classic designs: Soft and Glass. Only the visible names changed. Saved settings, theme ids and CSS are unchanged, so nobody loses their chosen look.
- **docker-compose.yml.** The version label now matches the release, and the optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` variables are passed to the container.
- README and mds/ARCHITECTURE.md use the new names.

## Notes
- No database or Render environment-variable change is required.

## Verification
- Run `npm test` before deployment.
- After deployment, ask NexAI who made it, then check the theme pickers in Classic and Enterprise.
