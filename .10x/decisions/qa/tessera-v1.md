# QA Decisions: tessera-v1

**Date:** 2026-10-11
**Phase:** 5 Verification, interim (M1 slice). Report: `.10x/reviews/2026-10-11-qa-report.md`

## Strategy

Risk first. The valuable asset is the learner's review history, so the heaviest testing is on idempotence, staleness, atomic import, restarts, and hard kills. The next risk is hostile content from an LLM or the internet, so sanitization is tested at both layers. UI risk is concentrated in a client-rendered keyboard-driven study screen, so it gets real-browser tests for failure paths, not just the happy path.

| Level | What | Count |
|---|---|---|
| Unit | Pure logic: schema, parsers, scheduler wrapper, study day, sanitizer, body reader | 319 |
| Integration | Real SQLite: import, queue, review, API, hooks | 232 |
| End to end (Chrome) | Import and study flows, XSS corpus, layout at four widths, themes, failure paths, accessibility (axe) | 50 |
| Against the built server | Smoke (28), security probe (101 plus 1 known), durability and concurrency (54), benchmark | scripts |
| Mutation check | 15 deliberate bugs, 14 caught | manual, results in the report |

## Gate results (commit `bb53e77`)

Types, lint, format clean. All suites above pass. Axe: 0 violations. Audit: 0 production findings. Coverage 92.1 percent lines, 85.3 percent branches.

## Defects

| ID | Finding | Status |
|---|---|---|
| Q-01 | Study screen had no h1 | Fixed |
| Q-02 | Oversized chunked body returned 500 | Fixed |

## Residual risks

Chromium only (no Firefox or Safari). Docker image never built and CI never run. No real screen reader pass. No year-long history benchmark. Typed and choice cards are self-graded until M2.

## Release readiness

M1 exit gate: ready with three conditions (owner confirmation, first green CI run, security items scheduled first in M2). Not releasable as v0.1.0; that gate is M2.

## M6 test strategy (2026-10-18)

Undo is the dangerous one: byte-for-byte invariance over grades 1 to 4 and every starting phase (new, learning, review, relearning), leech crossing, cloze siblings, stale tab (not newest, changed since), double undo, counts returning (reviews today, daily limit, streak), planted bugs. Practice undo deletes exactly one `cram` row and the existing whole-database invariance test still passes. Tag scope: Trash and archived excluded, no cards, invalid tag, exactly-one-scope. Quiz: pure builder unit tests (too few candidates, duplicates, long or multi-line, determinism, same-deck preference), API test, planted bug (right answer missing). Editor order: keyboard reorder, save, reload, ids and histories unchanged, stale save refused. E2E in Chromium and WebKit per slice, accessibility in both themes, phone layout at 320 px.

## M7 test strategy (2026-10-18)

Pure tests for the cookie and key; an every-route test that fails the build for an undecided route; the whole existing probe run signed in plus a new signed-out section; browser tests for the redirect round trip, a wrong password, both sign outs in two contexts, a mid-session 401, accessibility and 320 px; backup limit at, below and above; a chunked 20 KB body to every small-limit route.
