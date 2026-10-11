# Tessera

Self-hosted flashcards that Claude can write for you. Ask Claude for a deck, paste it in, study it with FSRS spaced repetition, and re-import a revised deck later without losing your progress.

**Status:** early development, milestone 2 of 5 under way. You can import decks, study them, and run it in Docker. Mermaid diagrams, leech handling, cram mode, and statistics are still to come. The plan lives in [`.10x/`](.10x/).

## What works today

- **Import a deck** by pasting JSON from Claude or choosing a file. A preview shows exactly what will change before anything is saved.
- **Fix mistakes in one round trip.** If a deck has problems, Tessera lists them with line numbers and offers a ready-made message to paste back to Claude, which names every problem and tells it to keep the card ids.
- **Re-import safely.** Cards are matched by their `id`. Re-importing a revised deck updates the text and keeps your review history. Importing the same file again changes nothing.
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

Open <http://localhost:3000>, choose **Import**, and paste the contents of [`examples/ccna-ospf.json`](examples/ccna-ospf.json) to try it.

Your data lives in a Docker volume. Do not back it up by copying `tessera.db` while Tessera is running, because recent changes sit in a side file and the copy can be empty. [docs/operations.md](docs/operations.md) has a one-line backup command that is safe while you study, plus restore, upgrade, and rollback steps. Take a backup before you rely on it.

### Security: there is no login

Tessera is a single-user app and has no accounts. `compose.yaml` publishes the port on `127.0.0.1` only, on purpose. To use it from another device, the safest route is a private network such as Tailscale, or a reverse proxy that asks for a password. [docs/deploy.md](docs/deploy.md) walks through each option and what to avoid. See [ADR-005](.10x/adrs/005-security-posture-without-login.md) for the reasoning and [SECURITY.md](SECURITY.md) to report a problem.

If you use a reverse proxy that terminates TLS, set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` (commented out in `compose.yaml`) so the app sees the real address.

The container runs as a non-root user with a read-only filesystem and no extra capabilities.

## Writing decks with Claude

Give Claude the deck schema, which Tessera serves at `/api/schema` (for example <http://localhost:3000/api/schema>), and ask for a deck on any topic. A good prompt:

> Make a Tessera deck on OSPF for the CCNA. Use the JSON Schema at the link above. Give every card a stable, descriptive `id`. Use cloze cards for lists and sequences, and typed cards for commands. Return only the JSON in one code block.

A minimal deck looks like this:

```json
{
	"tessera": 1,
	"deck": { "id": "capitals", "title": "Capital cities" },
	"cards": [
		{ "id": "france", "type": "basic", "front": "Capital of France?", "back": "Paris" },
		{ "id": "spain", "type": "cloze", "text": "The capital of Spain is {{c1::Madrid}}." }
	]
}
```

Card text is Markdown. Tables, code blocks, bold and italics work. Raw HTML is shown as text and images are not supported in this version. Tessera accepts JSON wrapped in a code fence, so you can paste Claude's reply directly.

The `id` is what ties a card to your history, so keep it stable. If Claude revises a deck, ask it to keep every existing `id`.

Limits: 5 MB and 5,000 cards per import.

## Configuration

| Variable                | Default                         | Meaning                                                                                                                                        |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`                          | Port to listen on                                                                                                                              |
| `DATA_DIR`              | `./data` (`/data` in the image) | Where the SQLite database lives                                                                                                                |
| `TZ`                    | `UTC`                           | Time zone that decides when a study day rolls over                                                                                             |
| `LOG_LEVEL`             | `info`                          | `debug`, `info`, `warn`, or `error`                                                                                                            |
| `TESSERA_API_TOKEN`     | unset                           | Reserved. Token protection for the API is planned for milestone 2 and is **not active yet**.                                                   |
| `TESSERA_ALLOWED_HOSTS` | unset                           | Host names Tessera answers to, comma separated (`*.example.com` allowed). Needed for a real domain name, see [docs/deploy.md](docs/deploy.md). |

## Development

```bash
npm ci
npm run dev          # development server
npm run verify       # type check, lint, schema check, unit and integration tests
npm run build
npm run test:e2e     # browser tests (needs Chrome, or run: npx playwright install chromium)
npm run benchmark    # 5,000 card import and study timings, see docs/performance.md
```

Node 24 is expected. Dependencies install with `ignore-scripts=true` (see [ADR-007](.10x/adrs/007-install-without-lifecycle-scripts.md)), so a clean `npm ci` needs no compiler.

More: [deploying](docs/deploy.md), [operating](docs/operations.md) (backup, restore, upgrade, troubleshooting), [releasing](docs/releasing.md), [changelog](CHANGELOG.md), [visual design](docs/design.md), [performance](docs/performance.md), [architecture decisions](.10x/adrs/).

## License

Tessera is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer its users the source of your changes.
