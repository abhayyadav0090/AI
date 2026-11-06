# NexOS 2.5.1: phone fixes for Enterprise

## Fixed
- **The Classic | Enterprise switch was cut off at the bottom of the menu on Chrome.** The Enterprise menu was as tall as the screen would be *without* Chrome's address bar and tab strip, so its bottom (including the switch) slid off-screen whenever those bars were showing. The menu now fits the part of the screen you can actually see, and scrolls if the screen is short. The same fix is applied to the NexAI side panel and to every other full-height area in Enterprise.
- **The menu (three lines) button sat against the corner.** Its icon is now centred in its button.

## Added
- **Habits in Enterprise's bottom bar** on phones, between Tasks and Focus: Home, Tasks, Habits, Focus, Notes, NexAI, More. All seven names fit on screens down to 320 px wide, and "More" no longer lights up while you are on Habits.
- **Classic | Enterprise switch in Enterprise's top bar on phones**, next to search and settings, so you can switch without opening the menu. On the smallest phones the page title gives way so nothing is squeezed. When you are not signed in, the Sign in link takes its place (it also leads to Classic).
- **An Experience row in Enterprise's settings (gear) menu**, on every screen size.

## Changed
- The browser tab title is now just **NexOS** (your change in `public/index.html`, kept).
- The old `docs/screenshots/dashboard-microsoft.png` is no longer included; it showed the removed Microsoft design.

Everything else is as in 2.5.0.
