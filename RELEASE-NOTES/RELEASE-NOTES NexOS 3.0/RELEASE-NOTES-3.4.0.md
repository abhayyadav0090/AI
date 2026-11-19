# NexOS 3.4.0 — NexAI Performance & Identity Refinement

## Performance
- Exact short greetings (for example, Hi, Hello, Hey, Namaste and Hare Krishna) use a lightweight server-side response and bypass the Gemini round-trip and workspace context. Substantive requests continue through Gemini.
- Adds privacy-safe server timing diagnostics for chat authentication lookup, chat database reads, Gemini generation, database saves and total request duration. Logs contain timing and payload-size metadata only, never prompts or workspace content.
- Avoids sleeping after the final failed retry attempt, removing an unnecessary 1–1.5 second wait when no further attempt will be made.

## Identity safeguards
- Reinforces that NexAI must not confirm a user's claimed creator identity based only on chat statements.
- Keeps Abhay Yadav as the creator according to trusted NexOS configuration and preserves existing contact/privacy safeguards.

## Compatibility
- Preserves existing Classic and Enterprise chat API response shape, chat persistence, Gemini path for substantive requests, attachment handling and workspace context.
- Service-worker cache updated to v18.

## Validation
- Run `npm test` before deployment.
- After deployment, compare `Server-Timing` and `[NexAI timing]` values for a greeting versus a substantive prompt.
