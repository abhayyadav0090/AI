# NexOS 3.3.1 — NexAI Mobile Layout and Voice Reliability

**Release line:** NexOS 3.x  
**Previous release:** 3.3.0  
**Release focus:** NexAI mobile usability, Classic/Enterprise consistency and speech-recognition reliability

## Overview

NexOS 3.3.1 refines the NexAI experience on phones and fixes duplicated text produced by browser speech recognition. It builds on the voice-input work introduced in 3.2.0 and the file-upload capability introduced in 3.3.0; it does not replace or redesign those features.

## What's changed

### 1. NexAI mobile controls

The mobile NexAI interface brings four frequently used controls together:

- **Action Mode** — open the existing Action Mode workflow.
- **New Chat** — start a new conversation.
- **Workspace Context** — open workspace context in a sheet instead of keeping the panel permanently below the chat.
- **Past Conversations** — open chat history in a sheet.

Context and history sheets can be dismissed using their close control, by selecting the active control again or by tapping outside the sheet. Opening a past conversation and starting a new chat close the sheet so the conversation remains the primary focus.

The chat area uses the available vertical space above the message composer and mobile navigation. This reduces the small, constrained chat-window effect on phones. The desktop layout is intended to remain unchanged.

### 2. Classic and Enterprise consistency

The mobile NexAI control pattern is carried into Classic as well as Enterprise. Classic-specific spacing corrections address the floating Add control overlapping the message-send control and unwanted page scrolling in the Apple design. The Google and Apple designs should retain their existing visual language.

### 3. Speech-recognition duplicate-text fix

Some browsers emit progressively longer recognition results during a single dictation session. Appending every result directly to the input can duplicate words—for example, a sequence such as `can`, `can you`, `can you listen` can become repeated text.

The updated dictation handling:

- Preserves the text that was already in the input when dictation starts.
- Rebuilds the dictated portion from the current recognition session instead of blindly appending every event.
- Handles multiple results in one recognition event.
- Replaces a shorter interim phrase when the browser supplies its longer version.
- Avoids appending a complete duplicate of text already recognised.
- Keeps dictation as input only; it does not automatically send a chat message, create a task or approve an Action Mode proposal.

The fix applies to the Classic and Enterprise voice-input paths, including NexAI chat and other supported microphone-enabled inputs.

## Existing capabilities carried forward

The following features were introduced in earlier releases and remain part of the 3.3.1 experience:

- **3.2.0 Voice Input:** browser-based dictation for NexAI chat, Action Mode and supported Add Task inputs in Classic and Enterprise. Language selection may include English (India) and Hindi where the browser supports the recognition service.
- **3.3.0 File Upload:** attach up to 3 supported files with a combined size of 6 MB to the main NexAI chat. Supported types include PDF, PNG, JPG, WEBP and supported text/code formats. DOCX is not supported; export Word documents to PDF. Attachments are validated and processed for the request rather than stored as permanent workspace files.

## Compatibility and behaviour

- Voice input requires a supported browser, microphone permission and a secure context (normally HTTPS). Speech-recognition support and language availability vary by browser and device.
- The microphone fills the relevant input field. Users retain control over sending messages and confirming actions.
- The mobile layout changes are targeted at phone-sized screens. Desktop layout should remain as before.
- File upload remains available in the main NexAI chat; the Enterprise side-panel chat does not gain an attachment control through this release note.

## Validation

The development work described a mocked SpeechRecognition regression test covering:

1. A single recognised phrase.
2. Progressively longer recognition events.
3. Multiple results returned within one event.
4. Two distinct phrases in one session.
5. Preserving text entered before dictation starts.

The earlier mic-fix work reported that the automated test suite passed. Before publishing this release, run `npm test` again on the final merged 3.3.1 project and test real microphone behaviour on supported desktop and Android/iOS browsers. A mocked recognizer does not replace device testing.

## Scope protection

- No Recovery Center changes are included.
- No change to the existing task, habit, notes, timer or analytics data model is intended.
- Existing NexAI Action Mode confirmation safeguards remain in place.
