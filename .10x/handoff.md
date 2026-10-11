# Handoff

**From:** SDE, Phase 4 Implementation, end of Milestone 1
**To:** The next session. Start M2 only after the owner confirms the M1 exit gate.
**Date:** 2026-10-10

## Where things stand

All 23 M1 tasks are done and verified in `C:\Dev\tessera` on `main`. Tessera is a working vertical slice: import a deck from Claude, study it with FSRS, run it in Docker.

| Area | State |
|---|---|
| Deck format | Strict Zod schema, JSON parser with fence, truncation, and located syntax errors, published JSON Schema, golden fixtures |
| Import | Read-only plan plus atomic commit. Re-import keeps history and writes nothing when unchanged |
| Scheduler | `ts-fsrs` behind our interface, 92-step conformance fixtures |
| Study | Queue with daily limits, learn-ahead as a last resort, burying, `submitReview` with idempotent replay, stale check, leech flag |
| HTTP | Hooks, CSP, content-type guard, routes for health, schema, decks, import, study next, study review |
| UI | "Tessera Desk" design. Home, import (preview, errors, Copy errors for Claude), keyboard-first study. All four card types render and are self-graded |
| Security | Two-layer Markdown sanitization, tested separately and together, 20-payload XSS corpus in Chrome |
| Container and CI | Dockerfile, hardened compose, GitHub Actions workflow with e2e and benchmark steps. **Never run on GitHub** |

Gate results are in `.10x/status.md`. In short: 309 unit, 232 integration, and 20 browser tests pass, smoke passes, the 5,000-card import takes about 1 s against a 10 s budget, 0 audit findings, licenses clean.

## What M2 starts with

| Task | Notes |
|---|---|
| M2-01 Cloze core | `core/cloze.ts` already has `listClozeOrdinals` and an interim `clozeSides(text, ordinal)` used by the study UI. Fold it into the proper module, do not duplicate |
| M2-02 | Sibling burying already lives in `submitReview`. M2-02 is mostly import and queue coverage |
| M2-03, M2-04, M2-10 | The study UI renders typed and choice cards but the learner grades them. Matching and auto-grading are new. `ui/card-sides.ts` is where card-type rendering is decided |
| M2-12 API token | **Blocked on a design decision**, see below |

## Decisions and corrections made during implementation

- **ADR-006:** the UI uses JSON `fetch` only, no form actions. adapter-node 6 has no `ORIGIN` and assumes `https`, so form posts fail on plain HTTP.
- **ADR-007:** `ignore-scripts=true` in `.npmrc`. A clean `npm ci` otherwise tries to compile `better-sqlite3` with `node-gyp`.
- **ADR-003 refined:** learn-ahead items are a last resort, not first in the queue. In the UI a card in a learning step returns as "Learning" when nothing else is due. This is intended and a browser test pins it.
- Deck `description` and `tags` omitted from a re-import are kept, not erased.
- Leech flagging landed in `submitReview` (M1-12), not M3-01.
- Fonts are static files in `static/fonts/` (the CSP allows only this origin). The saved theme is applied by `static/theme-init.js` before first paint.
- Counts in the API and UI are review items (a cloze blank is one item), not cards.
- Full running log with findings per task: `.10x/decisions/sde/tessera-v1.md`.

## Conventions to keep

- Imports include the file extension (`#lib/core/result.ts`). `erasableSyntaxOnly` is on. No enums or parameter properties.
- Write JSON files with the Write tool or Node, never PowerShell `Set-Content -Encoding utf8` (it adds a BOM).
- Gate every commit on `npm run verify` actually exiting 0. Redirect its output to a file and check `$LASTEXITCODE`. Do not pipe it into `Select-String` and check the pipe's exit code.
- Run `npm run build` before `npm run test:e2e`, `smoke`, or `benchmark`. They run the built server.
- Never leave a negative-control edit in place. Copy the file first and restore it.
- Colours live only in `tokens.css`. Font family names appear only there and in `fonts.css`.
- Use `resolve()` from `$app/paths` for every internal link (a lint rule enforces it).

## Open items that need the owner

1. **Confirm the M1 exit gate** so M2 can begin.
2. **API token versus the browser UI.** ADR-005 requires the bearer token on every `/api/*` route except `/healthz` and `/api/schema`. The UI calls those routes with no token, so turning the token on would lock the UI out. Recommendation: the token protects external clients only, the reverse proxy protects the UI, and the README says so. Needs a decision before M2-12, and ADR-005 amended.
3. **LICENSE file.** The AGPL-3.0 text is not on this machine. Downloading it from gnu.org needs permission. Also decide `AGPL-3.0-only` or `-or-later`.
4. **GitHub remote** (location, visibility) so CI can run and the Docker image can be verified. Nothing is pushed without approval.
5. **Docker Desktop** is optional locally. Without it, CI is the only image verification.

## Environment

Windows 11, Node 24.15.0, no Docker locally, Chrome installed (Playwright uses it), git repo at `C:\Dev\tessera`, branch `main`.
