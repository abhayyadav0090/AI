# NexOS 3.2.0 — Voice Input

NexOS 3.2.0 lets you speak instead of type in NexAI and when adding tasks, in both Classic and Enterprise. Account data, authentication, themes and the Recovery Center are unchanged.

## Changes
- **Mic in NexAI chat.** Classic now has a microphone beside Send (Enterprise already had one in chat and notes).
- **Mic in the NexAI side panel.** Enterprise's docked NexAI panel now has a mic beside its input.
- **Mic in Action Mode.** Speak your request, then review and approve the drafted actions as before. Nothing is submitted or changed automatically.
- **Mic in Add Task.** Classic: the quick Add a task field and the task dialog title and description. Enterprise: the Add task field in every Kanban column and the task dialog title and description.
- **Taller NexAI chat on phones (Enterprise).** The chat box now fills most of the screen, with tighter bubbles and a slimmer input area, so more of the conversation is visible. Workspace Context and Past Conversations stay below it. Desktop layout is unchanged.
- **Language.** Default is English (India). Long-press any mic button to switch to Hindi and back; the choice is remembered on the device.
- **Clear errors.** Blocked microphone permission, no speech heard and recognition failures show a short message.
- **Safer sessions.** Starting a second recording no longer gets cut off by the end of the first one; text respects each field's character limit.
- **Faster update.** Service worker cache namespace is nexos-shell-v7 and Classic assets use v=3.2.0.

## Notes
- Uses the browser's Web Speech API (works best in Chrome on Android and desktop). In browsers without it, Classic hides the mic buttons and Enterprise shows a short "not supported" message.
- Audio is handled by the browser's speech service; NexOS does not store it. No server, database or environment-variable change is required.
- File upload for NexAI is planned for 3.3.0.

## Verification
- Run `npm test` before deployment.
- After deployment, open the installed app once online, close it, reopen it, then test the mic in chat, Action Mode and Add Task on the phone.
