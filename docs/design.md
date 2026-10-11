# Visual design

This records the direction chosen for the interface and the rules that keep it consistent. The tokens live in `src/lib/ui/tokens.css`. Nothing else in the app defines a colour, a font, or a spacing value.

## Direction: Tessera Desk

A quiet study desk. Warm paper in light mode, warm charcoal in dark mode, one accent, and a reading serif for the cards so a card feels like something you read, not a form field.

| Decision           | Choice                                                                | Why                                                                                                              |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Surfaces           | Oat paper (light), warm charcoal (dark). No pure white or black.      | Long sessions are easier on the eyes, and the warmth separates Tessera from the grey default of most dashboards. |
| Accent             | One verdigris, the green of weathered copper.                         | A single accent keeps attention on the card. It is cool against warm paper, so it stands out without shouting.   |
| Card text          | Newsreader, a reading serif                                           | Cards are text to read and remember.                                                                             |
| Interface text     | Geist                                                                 | Clear at small sizes for buttons, labels, and counts.                                                            |
| Code and key hints | JetBrains Mono                                                        | Deck content is often commands and configuration.                                                                |
| Mark               | A two by two grid of tiles, one filled                                | A tessera is one tile of a mosaic.                                                                               |
| Layout             | A single reading column for study, a ledger of decks on the home page | Studying is one thing at a time. A deck list is a table of numbers, so it reads like a ledger.                   |

Both themes ship. The toggle cycles Auto, Light, Dark, and Auto follows the system. The saved choice is applied by a tiny script before first paint so a dark choice never flashes light (`static/theme-init.js`).

## Rules

- **Tokens only.** Colours are OKLCH custom properties that switch with `light-dark()`. Components reference `var(--color-...)`. A value that is not a token gets added to the token file first.
- **Contrast.** Every text and control pair that the app uses meets WCAG AA in both themes. It was checked in a browser, 36 of 36 pairs, and the grade colours are never the only signal: each grade button also has a label and an interval.
- **Type.** A 1.25 scale. Headings are upright, never italic. Two families carry the interface and a third appears only for code and key hints.
- **Spacing.** A 4 px grid. Radii are 4 and 6 px.
- **Motion.** Short and functional. Everything stops under `prefers-reduced-motion`.
- **Buttons have every state.** Default, hover, focus-visible, active, disabled, loading, error, success. Focus is always a visible ring.
- **Clickable text never wraps.** Buttons and nav links stay on one line at 320 px, enforced by a browser test.
- **No sideways scrolling.** Enforced at 320, 375, 414, and 768 px by a browser test.
- **Fonts are local.** The content security policy allows only this origin, so the font files are served from `static/fonts/` along with their SIL Open Font License texts. They are not npm dependencies.

## Study screen

The keyboard is the primary input, because that is how people get through hundreds of cards.

| Key            | Action                                                         |
| -------------- | -------------------------------------------------------------- |
| Space or Enter | Show the answer. After the answer is shown, Space grades Good. |
| 1, 2, 3, 4     | Again, Hard, Good, Easy                                        |
| H              | Show the hint, when the card has one                           |

Focus moves to the card when a new one appears and to the Good button once the answer is shown, so a keyboard or screen reader user is never left behind. Each grade button shows its key, its colour tile, its name, and the interval it will schedule, such as "10m" or "4d". On a phone the four buttons form a two by two grid.

## Not designed yet

Cram mode, stats, settings, and the weak-spot report arrive in later milestones. They will reuse these tokens and components.
