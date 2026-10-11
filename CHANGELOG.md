# Changelog

All notable changes to Tessera are written here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

First working version, built in milestone 1. Not yet released: the first public version will be 0.1.0, at the end of milestone 2.

### Added

- Import a deck by pasting JSON from Claude, choosing a file, or dropping one. A preview shows exactly what will change before anything is saved. Errors name the field and give line and column for syntax mistakes, and "Copy errors for Claude" produces a message that gets the deck fixed in one round trip.
- Re-importing a revised deck keeps your progress. Cards are matched by `id`. Importing an unchanged file changes nothing.
- Study with FSRS spaced repetition. Keyboard first: Space shows the answer, 1 to 4 grade it, H shows a hint. Interval labels on the buttons, daily new and review limits, cloze blanks scheduled separately and buried for the day.
- Four card types in the deck format: basic, cloze, typed answer, and multiple choice. For now you grade typed and choice cards yourself.
- Home screen with a deck list and counts.
- Light and dark themes that follow the system, usable on a phone.
- Docker image for `linux/amd64` and `linux/arm64`, a hardened `compose.yaml`, a health check, and graceful shutdown.
- Automatic backup before any database upgrade, and a documented way to take a backup while running.
- Operations guide, deployment guide, and release process in `docs/`.

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

- Typed-answer checking, Markdown deck import, Mermaid diagrams, leech handling, cram mode, statistics, and the API token are not built yet.
- Only Chrome has been tested.
