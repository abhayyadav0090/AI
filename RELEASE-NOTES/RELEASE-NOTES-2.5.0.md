# NexOS 2.5.0: Apple design replaces Microsoft

## Changed
- **The Microsoft design is gone; the second design is now Apple.** Everything else stays the same: same menus, same screens, same features, same Google design as before. The Apple design is a liquid-glass look:
  - frosted, translucent panels over a soft colour wash, in light and dark;
  - a floating rounded sidebar and top bar on desktop, and a floating tab bar on phones;
  - capsule buttons, iOS-style segmented switches (Experience, Design, Theme), large rounded cards and an SF-style type stack (it uses the system font, which is SF on Apple devices);
  - frosting turns itself into solid panels in browsers without blur support, or when the device asks for reduced transparency.
- **Enterprise**: the two blue Fluent themes are now **Apple Glass** (dark) and **Apple Light**, with the same frosted panels. Overgame is still the default for new accounts, and Material You is unchanged.
- The name appears everywhere it used to say Microsoft or Fluent: the login screen, the Settings picker, the quick appearance menu, the command palette ("Use Apple design"), theme lists and the documentation.

## Nothing is lost for existing users
- Anyone who had picked the Microsoft design opens in Apple. An Enterprise account that had saved a Fluent theme opens in the matching Apple theme (Fluent dark becomes Apple Glass, Fluent light becomes Apple Light), unless it was still on the old blue default, which moves to Overgame once as in 2.4.1.
- Accessibility: text and link colours in the Apple themes were checked against the frosted backgrounds (at least 4.5:1 for small text on the busiest part of the background).

## Checked
Every earlier test still passes (Classic 36, Enterprise navigation 23, data sync 17, adversarial 10, targeted 27, chat/theme/switch 26, menu row 7, unit tests), plus new checks for the Apple design: blur on panels, the floating sidebar, the phone tab bar, old saved names, and very long titles on every screen (48 of 48 fit).
