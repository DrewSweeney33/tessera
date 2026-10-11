# Tessera

Self-hosted flashcards that Claude can write for you. Ask Claude for a deck, paste it in, study it with FSRS spaced repetition, and re-import a revised deck later without losing your progress.

**Status:** early development, milestone 1 of 5. You can import decks, study them, and run it in Docker. Markdown deck import, typed-answer checking, leech handling, cram mode, and statistics are still to come. The plan lives in [`.10x/`](.10x/).

## What works today

- **Import a deck** by pasting JSON from Claude or choosing a file. A preview shows exactly what will change before anything is saved.
- **Fix mistakes in one round trip.** If a deck has problems, Tessera lists them with line numbers and offers a ready-made message to paste back to Claude, which names every problem and tells it to keep the card ids.
- **Re-import safely.** Cards are matched by their `id`. Re-importing a revised deck updates the text and keeps your review history. Importing the same file again changes nothing.
- **Study with FSRS** (the same family of algorithm used by Anki). Four grades, intervals shown on the buttons, daily new and review limits, and cloze blanks that are scheduled separately.
- **Keyboard first.** Space shows the answer, 1 to 4 grade it, H shows a hint.
- **Four card types** in the format: basic, cloze, typed answer, and multiple choice. For now typed and choice cards are graded by you after the answer is shown.
- **Light and dark themes**, usable on a phone.

## Quickstart with Docker

```bash
git clone <this repository>
cd tessera
docker compose up -d --build
```

Open <http://localhost:3000>, choose **Import**, and paste the contents of [`examples/ccna-ospf.json`](examples/ccna-ospf.json) to try it.

Your data lives in a Docker volume named `tessera-data`. To back it up, copy the file `/data/tessera.db` out of that volume while the container is stopped.

### Security: there is no login

Tessera is a single-user app and has no accounts. `compose.yaml` publishes the port on `127.0.0.1` only, on purpose. To use it from another device, either put a reverse proxy with authentication in front of it, or change the port mapping to `3000:3000` **only** on a network you fully trust. See [ADR-005](.10x/adrs/005-security-posture-without-login.md) for the reasoning.

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

| Variable                | Default                         | Meaning                                                                                      |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`                          | Port to listen on                                                                            |
| `DATA_DIR`              | `./data` (`/data` in the image) | Where the SQLite database lives                                                              |
| `TZ`                    | `UTC`                           | Time zone that decides when a study day rolls over                                           |
| `LOG_LEVEL`             | `info`                          | `debug`, `info`, `warn`, or `error`                                                          |
| `TESSERA_API_TOKEN`     | unset                           | Reserved. Token protection for the API is planned for milestone 2 and is **not active yet**. |
| `TESSERA_ALLOWED_HOSTS` | unset                           | Reserved. Host header allow-list, planned for milestone 2.                                   |

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

More: [visual design](docs/design.md), [performance](docs/performance.md), [architecture decisions](.10x/adrs/).

## License

AGPL-3.0. The license text file is added before the first release.
