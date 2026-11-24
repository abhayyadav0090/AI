# NexOS 4.1.1 — Day derailed and Study Studio, redesigned

This release only changes how the two dialogs look and behave in the browser. There are no server, API or data changes.

## Fixed
- **Missing icons (Classic):** the "Day derailed" and "Study Studio" chips now have the same small accent-coloured icons as the other dashboard chips (a new book icon was added to the icon set).
- **Wrong colours:** both dialogs used fixed dark colours. They now take their colours from the open page, so they follow Classic's Soft and Glass designs, light and dark mode and accent colour, and the Enterprise theme.
- **Phones:** on narrow screens both dialogs open as a bottom sheet with larger tap targets.

## Day derailed
- Choose the time you lost with large buttons (the chosen one stays highlighted) and see "NexAI is looking at N open tasks" with a spinner while it works.
- Proposals are cards with a priority label, NexAI's reason and the new date, a live "N of M selected" count, Select all / none, and an Approve button that says how many changes it will make.
- Nothing is applied until you approve; only due dates change. The guest sample uses the same layout.

## Study Studio
- Two tabs: **Tutor** and **Library**. With an empty library the Tutor tab asks you to add a document first.
- Library: drag-and-drop or tap to choose a file, optional title and subject, a usage meter, and a document list with Delete. After a successful upload it switches to the Tutor.
- Tutor: chat bubbles, a "reading your material" indicator, source chips under each answer (for example `[1] Biology ch 2 · p. 4`), a quieter style for "not found" answers, and starter prompts that fill the box (Explain simply, Practice questions, Solve step by step, Key definitions).
- Guests see the same layout with a scripted sample.

## Files
- Changed: `public/derail.js`, `public/study.js`, `public/index.html`, plus version strings (`package.json`, `package-lock.json`, `public/index-redesign.html`, `public/contact.html`, `public/sw.js` with cache `nexos-shell-v31`, `docker-compose.yml`, README, `mds/API.md`, `mds/ARCHITECTURE.md`, and the release tests).
- The version was raised so browsers and the service worker download the new scripts instead of reusing the cached 4.1.0 ones.
