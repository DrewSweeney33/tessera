# Tessera

Self-hosted flashcards that Claude can write for you. Ask Claude for a deck, paste it in, study it with FSRS spaced repetition, and re-import a revised deck later without losing your progress.

**Status:** early development, milestone 2 of 5 under way. You can import decks, study them, and run it in Docker. Leech handling, cram mode, and statistics are still to come. The plan lives in [`.10x/`](.10x/).

## What works today

- **Import a deck** in Markdown or JSON by pasting it from Claude or choosing a file. A preview shows exactly what will change before anything is saved.
- **Fix mistakes in one round trip.** If a deck has problems, Tessera lists them with line numbers and offers a ready-made message to paste back to Claude, which names every problem and tells it to keep the card ids.
- **Re-import safely.** Cards are matched by their `id`. Re-importing a revised deck updates the text and keeps your review history. Importing the same file again changes nothing.
- **Close the loop with Claude.** Cards you keep forgetting are flagged as leeches. One button copies a weak-spot report: your worst cards in the import format, with the wrong answers you typed, and a request to rewrite them. Paste it to Claude, import the answer, and the revised cards keep their history.
- **Manage decks by hand.** Make a new deck from a title, edit any card with a live preview (all four card types), add and remove cards, and change the title and tags. A save goes through the import code, so an edited card keeps its history, and a save from an out-of-date tab is refused instead of overwriting newer changes.
- **See how you are doing.** A Statistics page for every deck, a folder, or a deck: reviews, recall, streak, a 30-day forecast of what falls due, a calendar of the last half year, and your weakest tags. A folder can carry an exam date and counts down to it.
- **Practice again.** Go through a deck or a folder again before an exam without changing your schedule. A card you miss comes back until you get it right, and practice answers never count in your study numbers.
- **Group decks in folders.** Put the decks of a course or project in a folder on the decks screen, study just that folder, and see its statistics: reviews, time, how much you recalled, your streak, and the last two weeks. Folders only organize; deck files and imports do not change.
- **Delete safely.** A deleted deck waits in the Trash with everything you studied, and is removed for good only when you type its title. Start a deck over to study it from scratch, keeping the review history.
- **Back up from the page.** Back up now, download a backup to keep on another disk, and see the copies Tessera takes by itself before an upgrade or before anything it deletes.
- **Settings.** New cards per day (for each deck), reviews per day, target retention, the hour the study day starts, the leech threshold, and an option to mix new and due cards. Each is checked, explained in the page, and applies at once.
- **Study with FSRS** (the same family of algorithm used by Anki). Four grades, intervals shown on the buttons, daily new and review limits, and cloze blanks that are scheduled separately.
- **Keyboard first.** Space shows the answer, 1 to 4 grade it, H shows a hint.
- **Four card types** in the format: basic, cloze, typed answer, and multiple choice. Typed cards check what you type (case, spacing, and a final full stop are ignored), choice cards shuffle their options, and both suggest a grade that you can always change.
- **Light and dark themes**, usable on a phone.

## Quickstart with Docker

```bash
git clone <this repository>
cd tessera
docker compose up -d --build
```

Open <http://localhost:3000>, choose **Import**, and paste the contents of [`examples/ccna-ospf.json`](examples/ccna-ospf.json) to try it. [`examples/`](examples/) also has the same deck in Markdown, a PowerShell deck with code blocks, and a TCP/IP deck with diagrams.

Your data lives in a Docker volume. Do not back it up by copying `tessera.db` while Tessera is running, because recent changes sit in a side file and the copy can be empty. [docs/operations.md](docs/operations.md) has a one-line backup command that is safe while you study, plus restore, upgrade, and rollback steps. Take a backup before you rely on it.

### Security: there is no login

Tessera is a single-user app and has no accounts. `compose.yaml` publishes the port on `127.0.0.1` only, on purpose. To use it from another device, the safest route is a private network such as Tailscale, or a reverse proxy that asks for a password. [docs/deploy.md](docs/deploy.md) walks through each option and what to avoid. [docs/security.md](docs/security.md) says what Tessera protects, what it does not, and what you should do. See [ADR-005](.10x/adrs/005-security-posture-without-login.md) for the reasoning and [SECURITY.md](SECURITY.md) to report a problem.

If you use a reverse proxy that terminates TLS, set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` (commented out in `compose.yaml`) so the app sees the real address.

The container runs as a non-root user with a read-only filesystem and no extra capabilities.

## Writing decks with Claude

Tessera decks are plain text, so Claude can write them and you can import them without editing. There are three pieces:

- **[docs/claude-workflow.md](docs/claude-workflow.md)** shows how to ask, how to import, how to fix a deck that does not import, and how to revise one without losing your progress.
- **[claude-skill/tessera-deck](claude-skill/tessera-deck/SKILL.md)** is a Claude skill that teaches Claude the format and how to write good cards. Install it, or paste its contents at the start of a chat.
- **[docs/deck-format.md](docs/deck-format.md)** is the reference for the Markdown and JSON formats.

A good request:

> Make a Tessera deck on OSPF for the CCNA, from the notes below. About 30 cards. Give every card a stable, descriptive `id`. Use cloze cards for lists and sequences, and typed cards for commands. Reply with the deck only, in one code block.

A minimal deck in Markdown:

<!-- prettier-ignore -->
```markdown tessera-deck
---
tessera: 1
id: capitals
title: Capital cities
---

## france
Q: Capital of France?
A: Paris

## spain
Cloze: The capital of Spain is {{c1::Madrid}}.
```

and the same deck in JSON:

```json tessera-deck
{
	"tessera": 1,
	"deck": { "id": "capitals", "title": "Capital cities" },
	"cards": [
		{ "id": "france", "type": "basic", "front": "Capital of France?", "back": "Paris" },
		{ "id": "spain", "type": "cloze", "text": "The capital of Spain is {{c1::Madrid}}." }
	]
}
```

Card text is Markdown. Tables, code blocks (coloured for common languages), and Mermaid diagrams work. Raw HTML is shown as text and images are not supported. Tessera accepts a deck wrapped in a code fence, so you can paste Claude's reply directly.

The `id` is what ties a card to your history, so keep it stable. If Claude revises a deck, ask it to keep every existing `id`.

Limits: 5 MB and 5,000 cards per import.

## Configuration

| Variable                | Default                         | Meaning                                                                                                                                          |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                  | `3000`                          | Port to listen on                                                                                                                                |
| `DATA_DIR`              | `./data` (`/data` in the image) | Where the SQLite database lives                                                                                                                  |
| `TZ`                    | `UTC`                           | Time zone that decides when a study day rolls over                                                                                               |
| `LOG_LEVEL`             | `info`                          | `debug`, `info`, `warn`, or `error`                                                                                                              |
| `TESSERA_API_TOKEN`     | unset                           | Optional password for scripts that call the API. The web page does not need it and is not protected by it, see [docs/deploy.md](docs/deploy.md). |
| `TESSERA_ALLOWED_HOSTS` | unset                           | Host names Tessera answers to, comma separated (`*.example.com` allowed). Needed for a real domain name, see [docs/deploy.md](docs/deploy.md).   |

## Development

```bash
npm ci
npm run dev          # development server
npm run verify       # type check, lint, schema check, unit and integration tests
npm run build
npm run test:e2e     # browser tests in Chrome (or run: npx playwright install chromium)
npm run test:e2e:all # the same tests in Chrome, Firefox, and WebKit, one after the other (npx playwright install firefox webkit)
npm run benchmark    # 5,000 card import and study timings, see docs/performance.md
```

Browsers: Tessera needs `light-dark()` colours, so Chrome and Edge 123 or newer, Firefox 120 or newer, or Safari 17.5 or newer. CI runs the browser tests in Chrome, Firefox, and WebKit. Safari does not Tab to links unless the person turns that on (they use Option+Tab), so a keyboard user there reaches buttons and fields by Tab and links by Option+Tab.

Node 24 is expected. Dependencies install with `ignore-scripts=true` (see [ADR-007](.10x/adrs/007-install-without-lifecycle-scripts.md)), so a clean `npm ci` needs no compiler.

More: [deploying](docs/deploy.md), [operating](docs/operations.md) (backup, restore, upgrade, troubleshooting), [releasing](docs/releasing.md), [changelog](CHANGELOG.md), [visual design](docs/design.md), [performance](docs/performance.md), [architecture decisions](.10x/adrs/).

## License

Tessera is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer its users the source of your changes.
