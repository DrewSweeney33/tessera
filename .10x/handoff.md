# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-05 to M2-08, the Markdown deck format)
**To:** The owner (approve the push), then the SDE for M2-09
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (section "M2-05 to M2-08")

### Result

Decks can be written and imported in Markdown as well as JSON, through the same validator. Reader, writer, format detection, the `text/markdown` import route, and the import page are done. Property tests prove both formats round trip and agree; a mutation check (66 injected bugs) caught everything except one equivalent mutant after tests were added for the 19 gaps it found. The probe gained 16 Markdown hostile-input checks. Gates on a fresh build: verify (658 unit, 269 integration), 61 e2e, smoke, probe, durability, ops, licenses, audit all pass.

### State of git

M2-05 to M2-08 are committed locally and **not pushed**; they need the owner's approval (outside the CI-fix standing approval). `bf2bf7c` and earlier are on GitHub.

### Next

1. Owner: approve pushing the M2-05 to M2-08 commits.
2. M2-09 import preview detail, M2-10 study UI for cloze, typed, choice (uses `typed-match`, `choice`, `clozeSides`), M2-11 Mermaid and Shiki under the CSP, M2-12 API token (ADR-009), M2-13 Claude skill, `docs/deck-format.md`, golden decks (the author-facing documentation of the Markdown format belongs here), M2-14 e2e for all card types plus Firefox and WebKit, M2-16 gate (QA, security review, `v0.1.0` only after approval).

### Things to know

- `detect.ts` is for the import page only. The server never guesses the format.
- Markdown cannot hold every JSON deck (text starting with spaces, unclosed code fences, a blank line inside a choice). `serializeMarkdown` says why instead of writing a lossy file.
- Property tests are seeded (`FC_SEED`, `FC_RUNS` environment variables) so a failure reproduces.
- Open items from before are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, Firefox and Safari untested).

## Handoff history

### 2026-10-11: DevOps Engineer and SRE, Phase 6 Delivery (readiness of the M1 slice), to the owner and the SDE for M2

Delivery package for M1 (deploy, operations, release docs, release workflow, ops check) and four reliability fixes (ADR-008). Conditional sign-off for the owner's own use. GitHub setup, M2-00 (host check), ADR-009 (API token) decided and done after this handoff. Details in `.10x/decisions/devops/tessera-v1.md` and `.10x/decisions/sre/tessera-v1.md`.

### 2026-10-11: QA Engineer and Security Engineer, Phase 5 interim verification, to SDE, DevOps, and the owner

The M1 slice was sound. Two defects fixed (no h1 on the study screen, oversized chunked body gave 500). 14 of 15 injected bugs caught by the tests; the survivor (CSP loosening) is now covered by the security probe in CI. Two medium security items scheduled: S-01 DNS rebinding as new task M2-00, S-02 token versus UI as an owner decision. Reports in `.10x/reviews/2026-10-11-qa-report.md` and `2026-10-11-security-review.md`.

### 2026-10-10: SDE, end of Milestone 1, to the next session

All 23 M1 tasks done and verified. Backend, UI ("Tessera Desk" design), 20 browser tests, README and docs, benchmark, and CI steps in place. Decisions recorded: ADR-006 (JSON-only UI), ADR-007 (install scripts off), ADR-003 refinement (learn-ahead is a last resort), fonts as static files, `theme-init.js` for no flash, located JSON syntax errors.

### 2026-10-10: SDE, mid-Milestone 1, to the next session

16 of 23 tasks done: the whole backend (schema, parser, import, scheduler, queue, submitReview, routes, container, CI). UI tasks, e2e, benchmark, and docs remained.
