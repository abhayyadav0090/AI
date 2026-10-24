# NexOS 2.1.0 — Editorial Theme & Theme Reliability

## Visual refresh
- Applied an editorial, minimalist visual system inspired by the supplied reference.
- Standardized Ice Silver (`#DDE3E8`), Deep Aubergine (`#3A0F34`) and Marigold (`#FAA000`) as the core palette.
- Updated typography scale, card surfaces, buttons, navigation, focus states, background treatment and compact reminder controls.
- Improved topbar wrapping/scrolling at tablet and mobile widths.

## Light/dark theme fixes
- Unified the token set for backgrounds, surfaces, text, borders, chart grid and chart labels in both themes.
- Updated browser theme color and accessible theme-toggle label/pressed state when switching.
- Made timer SVG gradients and analytics chart colors follow the active theme; analytics rerenders immediately when switched to.
- Replaced several old fixed purple/cyan analytics and habit accents with the new palette.

## Preserved functionality
- Existing task, habit, note, analytics, focus timer, NexAI and authentication flows.
- Configurable daily task reminder time and reminder ON/OFF preference.
- No environment variables or external credentials changed.
