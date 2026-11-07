# NexOS 3.3.2 — Mobile Voice and NexAI Send Reliability

**Previous release:** 3.3.1  
**Release focus:** mobile dictation keyboard behaviour and duplicate chat submission prevention

## What's fixed

### 1. Mobile voice input no longer forces the keyboard open
- The chat field is temporarily made read-only and assigned `inputmode="none"` before recognition starts. This is more robust on Android than blur alone because the browser cannot reopen its keyboard for a read-only field.
- The transcript is still inserted programmatically and normal input events are dispatched.
- The first deliberate tap on the field restores its original editability and input mode before the browser handles focus, so the user can open the keyboard when they choose.

### 2. Enterprise chat rejects overlapping sends
- Added a shared in-flight guard for the main NexAI chat and floating Copilot chat.
- Rapid taps or repeated Enter presses while a request is running are ignored.
- Composer clearing dispatches an input event so UI listeners can stay synchronized.
- If a request fails, the original message is restored only when the user has not already typed a newer message.
- Attachment handling remains unchanged.

### 3. Enterprise NexAI mobile viewport
- The NexAI view is now constrained to the available space between the fixed top bar and bottom navigation.
- The four AI action buttons stay within the content area below the top bar; they no longer drift upward as the page grows.
- Only the message history scrolls. The overall page and the toolbar remain fixed while using NexAI on a phone.

### 4. Classic send behaviour regression coverage
- Classic already cleared its composer before the request and used a send-in-progress guard. Regression checks now explicitly protect both behaviours.

## Scope and compatibility
- No visual redesign; the mobile NexAI page receives a scroll-boundary correction only.
- No changes to the API, database schema, or attachment storage behaviour.
- Recovery Center (`public/recover.html`) is untouched.
- Speech recognition remains browser-dependent and requires microphone permission and a secure context.

## Validation
Automated regression checks cover the send lock, composer clearing, failure restoration, and no-focus voice handling. Run `npm test` on the final branch before merging. Real Android/iOS microphone and keyboard behaviour should also be checked on physical devices; static tests cannot prove OS keyboard behaviour.
