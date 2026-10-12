# Changelog

All notable changes to Tessera are written here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.0] - 2026-10-11

The first public version: import decks from Claude in JSON or Markdown, study with spaced repetition, and run it yourself in a container.

### Added

- Import a deck by pasting JSON from Claude, choosing a file, or dropping one. A preview shows exactly what will change before anything is saved: the old and new text of each edited card, a warning when a card changes type (which erases its progress), a warning when new cards look like old cards under new ids, and the cards the file does not mention. Errors name the field and give line and column for syntax mistakes, and "Copy errors for Claude" produces a message that gets the deck fixed in one round trip.
- Decks can also be written in Markdown: a block of deck details at the top, then `## card-id` headings with `Q:`, `A:`, `Cloze:`, `Answer:`, and `Choices:` lines. The import page and the `/api/import` endpoint (`Content-Type: text/markdown`) take either format, the page works out which one you pasted, and the same deck gives the same import in both. Errors in a Markdown deck give the line number.
- Re-importing a revised deck keeps your progress. Cards are matched by `id`. Importing an unchanged file changes nothing.
- Study with FSRS spaced repetition. Keyboard first: Space shows the answer, 1 to 4 grade it, H shows a hint. Interval labels on the buttons, daily new and review limits, cloze blanks scheduled separately and buried for the day.
- Four card types in the deck format: basic, cloze, typed answer, and multiple choice. Typed cards have an answer box and compare what you type with the answer and the accepted alternatives, ignoring case, extra spaces, and a final full stop. Choice cards show their options in a shuffled order (the same order if you refresh) with keys 1 to 9. Both suggest Good or Again and mark the right answer, and you can always pick a different grade.
- Code in cards is highlighted for 23 common languages (Python, PowerShell, Bash, SQL, YAML, JSON, TypeScript and more), readable in both themes. A `mermaid` code block is drawn as a diagram (flowcharts, sequence, state, class, entity relationship, pie, Gantt, and mind map diagrams were checked), with its source underneath. If a diagram cannot be drawn, its source is shown with a note. Both load only when a card needs them, and neither needed a change to the Content Security Policy.
- A Claude skill (`claude-skill/tessera-deck`), a deck format reference (`docs/deck-format.md`), a guide to making decks with Claude (`docs/claude-workflow.md`), and three example decks: CCNA OSPF (in JSON and Markdown), PowerShell essentials (code blocks), and TCP/IP fundamentals (diagrams and a table). Tests keep the documents in step with the code.
- A line under a choice that is indented but looks like a field label (for example `Explanation:`) is now an import error with a clear message, instead of silently becoming part of the choice. This is what a Markdown formatter does to a deck.
- "Copy errors for Claude" now asks for the corrected deck in the same format as the one you imported.
- Each release will carry the deck schema, the Claude skill as a zip, and a checksum file as downloads next to the container image, and the image is scanned for known vulnerabilities before a release can go out.
- Optional API token: with `TESSERA_API_TOKEN` set, scripts and tools calling `/api/*` must send `Authorization: Bearer <token>`. The web page keeps working without it, including over plain HTTP on a network address. Another website cannot reach the API through a visitor's browser. The token does not protect the web page itself, which has no login: keep it behind a VPN or a reverse proxy that asks for a password (see the deployment guide).
- Home screen with a deck list and counts.
- Light and dark themes that follow the system, usable on a phone.
- Docker image for `linux/amd64` and `linux/arm64`, a hardened `compose.yaml`, a health check, and graceful shutdown.
- Automatic backup before any database upgrade, and a documented way to take a backup while running.
- Operations guide, deployment guide, security page, and release process in `docs/`.

### Security

- Markdown in cards is rendered safely: raw HTML is shown as text, images and unsafe links are removed, and the result is sanitized again before it reaches the page.
- Content Security Policy, JSON-only write endpoints, no cross-origin access, request size limits, strict input validation, and logs that never contain card text.
- The port is published on `127.0.0.1` only by default. See the deployment guide before opening it up. There is no login.
- Tessera now refuses requests that arrive under a host name it is not meant to answer to, which blocks DNS rebinding attacks from hostile web pages. It answers `localhost`, any IP address, single-word names, and `.local`, `.lan`, `.home.arpa`, `.internal`, and `.localdomain` names by default. **If you reach Tessera by a real domain name, for example through a reverse proxy, set `TESSERA_ALLOWED_HOSTS`.** The refusal message says so.

### Fixed

- A request body over the size limit, sent in chunks, returned a server error instead of "too large".
- The study screen had no page heading for screen readers.
- A system clock that jumps backwards could make a card you had just answered impossible to answer again until the clock caught up.
- Two copies of Tessera on one data folder (for example an old container still running during an upgrade) made imports fail with "database is locked".
- A damaged database file produced an unexplained "file is not a database". It now names the file and says how to recover.
- Rolling back to an older version after an upgrade could silently open a newer database. It now refuses and explains.

### Known limitations

- Leech handling, cram mode, and statistics are not built yet.
- Browser tests run in Chrome, Firefox, and WebKit (the engine of Safari). Tessera has not been tried on a real Safari, iPhone, or Android device, or with a screen reader. Safari does not Tab to links by default, so on Safari use Option+Tab to reach links.
