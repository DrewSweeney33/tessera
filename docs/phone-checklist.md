# Phone checklist

A ten minute check on a real phone, for the person who runs Tessera. Automated tests cover the layout at 320 px and the accessibility rules, but only a real device shows how it feels. Do it after each release that changes the look or the installable app, and before 1.0.

You need Tessera reachable over HTTPS from the phone (for example `https://tessera.example.com` through a reverse proxy or a VPN), because Install and the offline page need a secure address.

## 1. Install

- [ ] Open the address in the phone's browser. The page loads and looks right in your phone's light or dark setting.
- [ ] Android (Chrome): the menu offers Install app (or Add to Home screen). iPhone (Safari): Share, then Add to Home Screen.
- [ ] The home screen icon is the four tiles, sharp, not cropped or on a white square (on Android the shape of the icon follows your launcher).
- [ ] Opening it shows Tessera in its own window with no address bar, and the bar at the top matches the app's colour.

## 2. Study

- [ ] Study a deck. Show answer, the answer buttons, and typed and choice cards are easy to reach with a thumb; the tab bar is hidden while studying.
- [ ] Rotate the phone. Nothing is cut off, and the answer buttons stay on screen.
- [ ] Practice again on a deck: Missed it and Got it work, and a missed card comes back.
- [ ] Open Stats. The charts fit the screen, the calendar scrolls sideways inside its own box and opens on the newest weeks, a tap on a day or a bar shows its number under the chart, and the page itself does not scroll sideways.
- [ ] Turn on large text in the phone's settings. The screens still fit, nothing runs off the right edge, and the tabs at the bottom may become icons only.
- [ ] Type an address that does not exist (add `/nothing` to the address). You get Tessera's own page with Back to decks, not a bare error.

## 3. Offline notice

- [ ] With the app open, switch on airplane mode. Open the app (or pull to reload). It says "Tessera needs your server", with a Try again button, instead of a browser error.
- [ ] Switch airplane mode off and press Try again. The real app comes back.
- [ ] While offline, nothing you studied is lost: reopen it and your progress is where you left it.

## 4. Dark mode and the system theme

- [ ] Change the phone between light and dark. The app follows it (or the toggle at the top overrides it) and text stays readable.

## 5. Screen reader (if you can)

- [ ] Turn on TalkBack (Android) or VoiceOver (iPhone). Move through the Decks screen: each deck is announced with its counts, and the buttons say what they do.
- [ ] Study one card: the question, the answer, and the answer buttons are read in a sensible order.
- [ ] On Stats, each chart is announced with a summary and its numbers are available as a table.

## Write down what you find

Anything that feels wrong is worth an issue, even if small: which screen, what you did, what you saw, the phone and browser. Include a screenshot if you can.
