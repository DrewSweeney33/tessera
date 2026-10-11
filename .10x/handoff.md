# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-09 and M2-10, import preview detail and the study screen for typed and choice cards)
**To:** The owner (approve the push), then the SDE for M2-11
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (section "M2-09 and M2-10")

### Result

The import preview now shows old and new text, warns about retypes and about ids that look changed, and lists missing cards. Typed cards have an answer box and matching, choice cards shuffle and mark, both suggest a grade and let the learner pick any. Gates on a fresh build: verify (673 unit, 290 integration), 87 e2e, smoke, probe (156), durability, ops, licenses, audit all pass. Mutation checks caught all injected bugs after one test gap was closed.

### State of git

M2-05 to M2-08 are on GitHub. M2-09 and M2-10 are committed locally and **not pushed**; they need the owner's approval.

### Next

1. Owner: approve pushing M2-09 and M2-10. Also worth trying: import a revised deck on the real app and tell me whether the id-change and mostly-replaced warnings fire at sensible times (the thresholds are guesses).
2. M2-11 Mermaid and Shiki under the CSP, M2-12 API token (ADR-009), M2-13 Claude skill, `docs/deck-format.md`, golden decks, M2-14 e2e for everything plus Firefox and WebKit, M2-16 gate (QA, security review, `v0.1.0` only after approval).

### Things to know

- Good, Hard, and Again keep a new card in a learning step and it returns at once when nothing else is due. Only Easy ends the session for that card. Tests must account for it.
- Choice options render as inline text with links removed. Code blocks inside an option are shown inline.
- Space and Enter after an attempt give the suggested grade, which is Again after a wrong answer. The hint line says so.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, Firefox, Safari and screen readers untested).

## Handoff history

### 2026-10-11: SDE, M2-05 to M2-08, to the owner

Markdown deck format (reader, writer, detection, import route and page). Property tests and a 66-bug mutation check. See the SDE log section "M2-05 to M2-08".

### 2026-10-11: DevOps Engineer and SRE, Phase 6 Delivery (readiness of the M1 slice), to the owner and the SDE for M2

Delivery package for M1 (deploy, operations, release docs, release workflow, ops check) and four reliability fixes (ADR-008). Conditional sign-off for the owner's own use. GitHub setup, M2-00 (host check), ADR-009 (API token) decided and done after this handoff. Details in `.10x/decisions/devops/tessera-v1.md` and `.10x/decisions/sre/tessera-v1.md`.

### 2026-10-11: QA Engineer and Security Engineer, Phase 5 interim verification, to SDE, DevOps, and the owner

The M1 slice was sound. Two defects fixed (no h1 on the study screen, oversized chunked body gave 500). 14 of 15 injected bugs caught by the tests; the survivor (CSP loosening) is now covered by the security probe in CI. Two medium security items scheduled: S-01 DNS rebinding as new task M2-00, S-02 token versus UI as an owner decision. Reports in `.10x/reviews/2026-10-11-qa-report.md` and `2026-10-11-security-review.md`.

### 2026-10-10: SDE, end of Milestone 1, to the next session

All 23 M1 tasks done and verified. Backend, UI ("Tessera Desk" design), 20 browser tests, README and docs, benchmark, and CI steps in place. Decisions recorded: ADR-006 (JSON-only UI), ADR-007 (install scripts off), ADR-003 refinement (learn-ahead is a last resort), fonts as static files, `theme-init.js` for no flash, located JSON syntax errors.

### 2026-10-10: SDE, mid-Milestone 1, to the next session

16 of 23 tasks done: the whole backend (schema, parser, import, scheduler, queue, submitReview, routes, container, CI). UI tasks, e2e, benchmark, and docs remained.
