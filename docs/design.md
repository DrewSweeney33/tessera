# Visual design

This records the direction chosen for the interface and the rules that keep it consistent. The tokens live in `src/lib/ui/tokens.css`. Nothing else in the app defines a colour, a font, or a spacing value.

## Direction: Tessera Desk, version 2

A quiet study desk, now with depth. Warm paper in light mode, warm charcoal in dark mode, one accent, and a reading serif for the cards so a card feels like something you read, not a form field. Version 2 keeps the version 1 palette and adds layered surfaces, soft shadows, larger radii, and an app shell built for a phone first.

| Decision           | Choice                                                                                       | Why                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Surfaces           | Oat paper (light), warm charcoal (dark), with sunken, surface, and raised layers.            | Long sessions are easier on the eyes. Raised layers and a soft shadow make a card feel like a sheet of paper.     |
| Accent             | One verdigris, the green of weathered copper, with a deeper shade for gradients and buttons. | A single accent keeps attention on the card. Its deeper shade lets a gradient keep text contrast at every point.  |
| Queue colours      | New is blue, learning is amber, review is green.                                             | The same convention as other study apps, so a new learner already knows what the three numbers are.               |
| Card text          | Newsreader, a reading serif                                                                  | Cards are text to read and remember.                                                                              |
| Interface text     | Geist                                                                                        | Clear at small sizes for buttons, labels, and counts.                                                             |
| Code and key hints | JetBrains Mono                                                                               | Deck content is often commands and configuration.                                                                 |
| Mark               | A two by two grid of soft tiles, one outlined                                                | A tessera is one tile of a mosaic. The same shape is the Decks icon, the empty state, and the Today card's motif. |
| Shell              | A rail on a desktop, a tab bar under the thumb on a phone                                    | One navigation element, restyled by screen size, so there is never a second copy to keep in step.                 |
| Home               | A Today card, then a grid of deck tiles                                                      | The first question is "what is waiting?". The Today card answers it and starts the session in one tap.            |
| Study              | One card, one bar, one dock                                                                  | Studying is one thing at a time. The dock keeps the next action at the bottom of the screen, in reach of a thumb. |

Both themes ship. The toggle cycles Auto, Light, Dark, and Auto follows the system. The saved choice is applied by a tiny script before first paint so a dark choice never flashes light (`static/theme-init.js`).

## Shell

- **Phone (under 64rem).** A slim top bar with the mark and the theme toggle, and a tab bar fixed to the bottom with Decks, Import, Leeches, and Settings. Trash and Backups are rare, so they have no tab: they are two rows at the bottom of Settings. The Leeches tab carries a count when cards need attention. Studying hides both bars, so the card has the whole screen.
- **Desktop (64rem and up).** The same navigation becomes a rail down the left: Decks, Import, Leeches, Settings, and Trash and Backups at the foot. The rail stays during studying, as a way out.
- **Safe areas.** The bars and the dock add the device's safe-area insets, so nothing sits under a home indicator or a notch.

## Rules

- **Tokens only.** Colours are OKLCH custom properties that switch with `light-dark()`. Components reference `var(--color-...)`. A value that is not a token gets added to the token file first.
- **Contrast.** Every text and control pair that the app uses meets WCAG AA in both themes, and axe-core checks every screen state in both. Grade colours are never the only signal: each grade button also has a name and an interval. The page background is one solid colour, with the verdigris glow on a separate fixed layer, so contrast stays measurable.
- **Type.** A 1.25 scale, with one large display size for the Today count. Headings are upright, never italic. Two families carry the interface and a third appears only for code and key hints.
- **Spacing.** A 4 px grid. Radii are 8, 12, 18, and 26 px: controls use 12, tiles and panels 18, and the card and the Today card 26.
- **Depth.** Three shadow heights built from one shadow colour. In dark mode a lighter surface does most of the work, and the shadow is only a deep, quiet edge.
- **Motion.** Short and functional: transform and opacity only, 120 to 320 ms. The card slides in, the answer fades in, the progress bar eases, and the done seal springs. Everything stops under `prefers-reduced-motion`.
- **Buttons have every state.** Default, hover, focus-visible, active, disabled, loading, error, success. Focus is always a visible ring.
- **Touch.** Every control and every standalone link is at least 44 px high (an inline link inside a sentence is exempt). Browser tests check the way back on every inner page and the folder links. The breadcrumb looks one line tall but has a 44 px touch area: the extra height is padding that a negative margin takes back. Key hints (`kbd`) are hidden where there is no hover, because a phone has no keys.
- **Clickable text stays on one line while it fits.** Buttons and nav links are one line at 320 px at the normal text size, enforced by a browser test. At larger text sizes a button wraps instead of running off the screen (`white-space` is normal and `max-width` is 100 percent).
- **No sideways scrolling, and nothing lost at large text.** Enforced at 320, 375, 414, and 768 px by a browser test, and at 200 percent text on a 320 px phone: no text may end up past the screen edge (the page is clipped sideways, so anything past the edge would be lost). Every grid that holds a single column of content has `grid-template-columns: minmax(0, 1fr)`, because a bare `auto` track grows to the widest word or button and pushes the page wide.
- **The tab bar at large text.** It measures its own width in `rem`, so the test follows the text size. Down to 18rem of room it keeps five labels; below that the labels stay for screen readers and the icons carry the tabs.
- **Charts on a phone are never scaled down.** A drawing keeps its own size and scrolls sideways inside a labelled, focusable region, opening on the newest data. Axis labels are drawn at least 12 px tall. A phone has no hover, so a tap on a bar or a day shows its number under the chart; the same numbers are in a table for screen readers.
- **Errors have a page of their own.** An address that does not exist, or a page that breaks, shows `+error.svelte`: a plain sentence, the app around it, and Back to decks. The raw message is never shown.
- **No card inside a card.** A folder is a panel; the decks inside it are rows with a rule between them on a phone, tiles only on a wider screen.
- **One accent edge style.** A notice or hint has a full border and a tint, never a thick stripe down one side. A quiet grey rule beside quoted text or a diff (leeches, the import preview) is a quotation mark, not a stripe, and stays.
- **One place to do each thing.** A folder has one Practice button. When its exam is near the button is highlighted and the countdown line says so, with no second link.
- **A first-run or empty state is not an error.** It is a neutral message that says what to do next.

- **Icons are shapes, not markup.** `Icon.svelte` draws a fixed set of line icons (the Lucide set, ISC licence) from plain shape data, so no `{@html}` is needed outside the Markdown component. Icons are decorative: the control around one carries the name.
- **Fonts are local.** The content security policy allows only this origin, so the font files are served from `static/fonts/` along with their SIL Open Font License texts. They are not npm dependencies.

## Study screen

The keyboard is the primary input on a desktop, and a thumb is the primary input on a phone. Both reach every action.

| Key            | Action                                                         |
| -------------- | -------------------------------------------------------------- |
| Space or Enter | Show the answer. After the answer is shown, Space grades Good. |
| 1, 2, 3, 4     | Again, Hard, Good, Easy                                        |
| H              | Show the hint, when the card has one                           |

Focus moves to the card when a new one appears and to the Good button once the answer is shown, so a keyboard or screen reader user is never left behind. The four grade buttons sit in one row in the dock, each with its name and the interval it will schedule, such as "10m" or "4d", and a coloured edge. On a desktop each also shows its key. A bar under the header shows how far through the session you are.

## Not designed yet

Nothing is waiting. Practice again, Statistics, and the installable app (ADR-017, ADR-018) use these tokens and components.
