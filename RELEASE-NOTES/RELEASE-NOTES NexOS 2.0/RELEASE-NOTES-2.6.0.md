# NexOS 2.6.0: Settings keeps the full layout on a laptop

## Changed
- **Laptop (901px and wider):** Settings shows every section open, with the big Google and Apple preview cards, like before 2.5.9. The sections cannot be folded there.
- **Phone and small tablet:** Settings keeps the short list from 2.5.9: folded rows with a one-line summary, and small Google/Apple buttons. It always opens folded.
- Rotating or resizing the screen while Settings is open switches between the two layouts.

## Kept from 2.5.9 on both layouts
- Your setup near the top, one data row (Download my data, Restore, Recently deleted), Save name only after a change, reminders that save when switched, and the one-time Home setup card.

## Fixed
- **Enterprise showed the "What will you use NexOS for?" card on every Home,** even for accounts that already had a goal and tasks. The card's styling overrode its hidden state. It now shows only for a new, empty workspace that has not answered yet.
