# Handoff

**From:** SDE, Phase 4 Implementation, mid-Milestone 1
**To:** The next session continuing M1 (UI, end-to-end test, docs), then the M1 exit gate
**Date:** 2026-10-10

## Where things stand

16 of 23 M1 tasks are done and committed on `main` in `C:\Dev\tessera`. The whole backend exists and is verified:

| Area | State |
|---|---|
| Deck format | Strict Zod schema, JSON parser with fence and truncation handling, published JSON Schema, golden fixtures |
| Import | Read-only plan plus atomic commit. Re-import keeps history and writes nothing when unchanged |
| Scheduler | `ts-fsrs` behind our interface, 92-step conformance fixtures, read-only reader for cram |
| Study | Queue with daily limits, learn-ahead, burying, interleave. `submitReview` with idempotent replay, stale check, leech flag |
| HTTP | Hooks, CSP, content-type guard, routes for health, schema, decks, import, study next, study review |
| Container and CI | Dockerfile, hardened compose, GitHub Actions workflow (not yet run), license and audit checks |

`npm run verify` is green: 233 unit and 231 integration tests, strict types, lint, schema drift check. `npm run smoke` passes 28 checks against the real production server.

## Remaining M1 tasks (see `.10x/status.md`)

| Task | Notes |
|---|---|
| M1-14 Visual direction, tokens, app shell | **Needs the owner's approval of a direction** (screenshot via the built-in browser). Use the `impeccable` or `hallmark` skills. Keep it to half a day. |
| M1-15 `Markdown.svelte` plus XSS corpus | Sanitization tests must run in a real browser, which needs Playwright's Chromium (a download, needs permission) or the built-in browser pane |
| M1-16 Import UI | Paste, file drop, preview counts, error list, "Copy errors for Claude". Uses `fetch` JSON only (ADR-006) |
| M1-17 Home deck list | Counts are review items, not cards (a cloze blank is one item). Use `countQueue` so numbers match sessions |
| M1-19 Study UI for basic cards | Keyboard only: Space reveals, 1 to 4 grade. Interval labels come from `previews` |
| M1-22 e2e plus benchmark | Needs Playwright browsers. 5,000-card import benchmark against the budget (under 10 s) |
| M1-23 README quickstart and example deck | `examples/ccna-ospf.json` can reuse `tests/fixtures/decks/valid/ccna-ospf.json` |

Then the M1 exit gate: write the milestone summary into `.10x/decisions/*`, update this file, and stop for the owner's confirmation.

## Decisions and corrections made during implementation

- **ADR-006:** the UI uses JSON `fetch` only, no form actions. adapter-node 6 has no `ORIGIN` and assumes `https`, so form posts fail on plain HTTP.
- **ADR-007:** `ignore-scripts=true` in `.npmrc`. A clean `npm ci` otherwise tries to compile `better-sqlite3` with `node-gyp`.
- **ADR-003 refined:** learn-ahead items are a last resort, not first in the queue.
- Deck `description` and `tags` omitted from a re-import are kept, not erased.
- Leech flagging landed in `submitReview` (M1-12), not M3-01.
- Full running log with findings per task: `.10x/decisions/sde/tessera-v1.md`.

## Conventions to keep

- Imports include the file extension (`#lib/core/result.ts`). `erasableSyntaxOnly` is on. No enums or parameter properties.
- Write JSON files with the Write tool or Node, never PowerShell `Set-Content -Encoding utf8` (it adds a BOM).
- Gate every commit on `npm run verify` actually exiting 0. Do not pipe it into `Select-String` and check the pipe's exit code.
- Counts in the API and UI are review items.

## Open items that need the owner

1. **Visual direction** for the UI (reference apps, dark or light first, or let the design skill propose one).
2. **LICENSE file.** The AGPL-3.0 text is not on this machine. Downloading it from gnu.org needs permission. Also decide `AGPL-3.0-only` or `-or-later`.
3. **Playwright browser download** (Chromium, roughly 150 MB) for the end-to-end and XSS tests.
4. **GitHub remote** (location, visibility) so CI can run and the Docker image can be verified. Nothing is pushed without approval.
5. **Docker Desktop** is optional locally. Without it, CI is the only image verification.

## Environment

Windows 11, Node 24.15.0, no Docker locally, git repo at `C:\Dev\tessera`, branch `main`, about 30 commits.
