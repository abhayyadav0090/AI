# NexOS 3.3.0 — File Upload for NexAI

NexOS 3.3.0 lets you attach files to a NexAI chat message, in both Classic and Enterprise. Use it to have a document analysed or to get an assignment solved step by step. Account data, authentication, themes and the Recovery Center are unchanged.

## Changes
- **Attach button in NexAI chat.** A paperclip beside the message box opens the file picker (on a phone this includes the camera and gallery). Up to 3 files per message, 6 MB in total. Chosen files show as removable chips above the box.
- **Supported files.** PDF, PNG, JPG, WEBP and text or code files (txt, md, csv, json, py, js, java, c, cpp and similar). Large photos are shrunk on your device before sending.
- **Assignments and documents.** NexAI solves assignments and problem sets step by step with its working shown, and summarises or answers questions about documents. You can send a file with no text and NexAI will analyse it.
- **Checked on the server.** Files are verified by their real content, not the file name, and are limited by count and size. Text from a file is treated as data, never as instructions.
- **Private.** Files are sent only with that message and are not stored. The saved conversation keeps your message and the file names, not the file.
- **Safe failure.** If sending fails, your message and files stay in the box so you can try again.
- **Large uploads only for chat.** The larger request size applies to the NexAI chat route only, after login and rate limits. All other routes keep their previous limits.
- **Faster update.** Service worker cache namespace is nexos-shell-v8 and Classic assets use v=3.3.0.

## Notes
- Each message with files counts as one AI request towards the usual per-minute and daily limits.
- Because files are not stored, attach the file again if you want NexAI to look at it again in a later message. NexAI still remembers its own earlier answers in the chat.
- Word (.docx) is not supported yet; save it as PDF first. The docked NexAI side panel in Enterprise does not take attachments yet.
- No database migration or environment-variable change is required.

## Verification
- Run `npm test` before deployment.
- After deployment, open the installed app once online, close it, reopen it, then attach a PDF, a photo and a text file in Classic and Enterprise and ask NexAI about them.
