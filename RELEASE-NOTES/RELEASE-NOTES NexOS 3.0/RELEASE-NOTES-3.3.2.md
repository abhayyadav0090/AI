# NexOS 3.3.2 — Mobile Voice and NexAI Send Reliability

**Previous release:** 3.3.1  
**Release focus:** mobile dictation keyboard behaviour and duplicate chat submission prevention

## What's fixed

### 1. Mobile voice input no longer forces the keyboard open
- Removed automatic focus on the text field after speech recognition returns a transcript in Classic and Enterprise.
- The transcript is still inserted into the correct input and normal input events are dispatched.
- Users can tap the text field whenever they want to edit the dictated text; dictation itself no longer deliberately summons the software keyboard.

### 2. Enterprise chat rejects overlapping sends
- Added a shared in-flight guard for the main NexAI chat and floating Copilot chat.
- Rapid taps or repeated Enter presses while a request is running are ignored.
- Composer clearing dispatches an input event so UI listeners can stay synchronized.
- If a request fails, the original message is restored only when the user has not already typed a newer message.
- Attachment handling remains unchanged.

### 3. Classic send behaviour regression coverage
- Classic already cleared its composer before the request and used a send-in-progress guard. Regression checks now explicitly protect both behaviours.

## Scope and compatibility
- No UI redesign or layout changes.
- No changes to the API, database schema, or attachment storage behaviour.
- Recovery Center (`public/recover.html`) is untouched.
- Speech recognition remains browser-dependent and requires microphone permission and a secure context.

## Validation
Automated regression checks cover the send lock, composer clearing, failure restoration, and no-focus voice handling. Run `npm test` on the final branch before merging. Real Android/iOS microphone and keyboard behaviour should also be checked on physical devices; static tests cannot prove OS keyboard behaviour.
