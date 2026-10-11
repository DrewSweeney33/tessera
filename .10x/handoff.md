# Handoff

## Current handoff

**From:** QA Engineer and Security Engineer, Phase 5 Verification (interim, M1 slice)
**To:** SDE for the start of M2, DevOps for the first CI run, and the owner for three decisions
**Date:** 2026-10-11
**Reports:** `.10x/reviews/2026-10-11-qa-report.md`, `.10x/reviews/2026-10-11-security-review.md`
**Per-feature files:** `.10x/decisions/qa/tessera-v1.md`, `.10x/decisions/security/tessera-v1.md`

### Result

The M1 slice is sound. No blocking findings. Two defects were found and fixed (Q-01 missing h1 on the study screen, Q-02 oversized chunked body gave 500). `main` is at `bb53e77` plus the state commit. Every gate is green: 319 unit, 232 integration, 50 browser, 28 smoke, 101 security probe checks (1 known open gap), 54 durability checks, axe clean, 0 production audit findings, import of 5,000 cards in about 1 s.

### What to do next, in order

1. **M2-00: host check against DNS rebinding (security S-01).** Medium. With `TESSERA_ALLOWED_HOSTS` unset, accept `localhost`, loopback and other IP literals, and single-label or `.local`, `.lan`, `.home.arpa`, `.internal` names, and answer 421 for other dotted public names. Add the startup warning ADR-005 promises. Flip the probe check "foreign Host header" from `known(...)` to `check(...)`. Tests: unit for the matcher, probe for the real server, a note in the README.
2. **Owner decision S-02 (token vs UI), then amend ADR-005,** then M2-12.
3. **Normal M2 work** (M2-01 onward). Keep the layers: new routes go in the probe, new UI states go in the axe spec.
4. **DevOps:** create the GitHub remote (owner decision) and read the first CI run. Linux has never run `security-probe`, `durability-check`, the e2e job, or the Docker jobs. Fix what breaks before anything else.

### Test tooling now available

| Command | What it checks | Needs |
|---|---|---|
| `npm run verify` | Types, lint, format, schema drift, unit and integration tests | nothing |
| `npm run build` then `npm run test:e2e` | 50 Chrome tests, including axe, failure paths, hostile layout | Chrome (or `npx playwright install chromium`) |
| `npm run smoke` | 28 checks on the built server | a build |
| `npm run security:probe` | 101 adversarial checks on the built server | a build |
| `npm run durability` | restarts, SIGKILL during import and after a grade, parallel writes, SQLite integrity | a build |
| `npm run benchmark` | 5,000 card import and study timings against a 10 s budget | a build |
| `npx vitest run --testTimeout=90000 --coverage.enabled --coverage.provider=v8 --coverage.include="src/lib/**/*.ts"` | coverage (slows the ESLint layer test, hence the timeout) | nothing |

### Residual risks (from the QA report)

Chromium only. No Docker image built. CI never run. No real screen reader pass. No year-long history benchmark. Typed and choice cards are self-graded until M2-03, M2-04, M2-10.

### Lessons to keep applying

- Every security or integrity test gets a negative control (break it, watch the test fail). It found two gaps this phase.
- Test each layer of a two-layer defence alone.
- The e2e database persists across tests. Each test imports its own deck.
- The app is client-rendered. Wait for the card before pressing keys.
- Windows has no SIGTERM. Graceful shutdown is checked on Linux in CI.
- Use `git commit -F file` for messages containing double quotes in PowerShell 5.1.

### Open items that need the owner

1. **Confirm the M1 exit gate** so M2 can begin.
2. **S-02: how should the API token work?** Recommendation in `.10x/status.md`. Needed before M2-12.
3. **LICENSE file.** Permission to download the AGPL-3.0 text from gnu.org, and `AGPL-3.0-only` or `-or-later`.
4. **GitHub remote** (location, visibility). Nothing is pushed without approval. This also unblocks the first CI run.
5. **Docker Desktop** is optional locally.

## Handoff history

### 2026-10-10: SDE, end of Milestone 1, to the next session

All 23 M1 tasks done and verified. Backend, UI ("Tessera Desk" design), 20 browser tests, README and docs, benchmark, and CI steps in place. Decisions recorded: ADR-006 (JSON-only UI), ADR-007 (install scripts off), ADR-003 refinement (learn-ahead is a last resort), fonts as static files, `theme-init.js` for no flash, located JSON syntax errors. Open items then: M1 gate confirmation, API token vs UI tension, LICENSE, GitHub remote, Docker Desktop. Full log in `.10x/decisions/sde/tessera-v1.md`.

### 2026-10-10: SDE, mid-Milestone 1, to the next session

16 of 23 tasks done: the whole backend (schema, parser, import, scheduler, queue, submitReview, routes, container, CI). UI tasks, e2e, benchmark, and docs remained.
