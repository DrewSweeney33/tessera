# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-13, the Claude skill, format reference, workflow guide, and golden decks)
**To:** The owner (approve the push and try the skill), then the SDE for M2-14
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (section "M2-13")

### Result

The skill, `docs/deck-format.md`, `docs/claude-workflow.md`, and three golden decks exist, and tests keep every document in step with the code. All gates pass on a fresh build.

### State of git

M2-05 to M2-12 are on GitHub. M2-13 is committed locally and **not pushed**.

### Needs the owner

1. **Approve the push.**
2. **Try the skill on a real conversation.** Install `claude-skill/tessera-deck` (or paste `SKILL.md`), give Claude some notes you actually want to study, and import what it writes. Tell me what went wrong. That is the real test of the skill, and nothing automated can stand in for it.
3. **Skim the three example decks for factual errors** if you plan to study from them (PowerShell, OSPF, TCP/IP). I checked them carefully but I am not a subject expert.
4. **Read the "Do not run a Markdown formatter" paragraph** in `docs/deck-format.md` and say if the `label_in_choice` rule is acceptable (it makes an indented `Explanation:` under a choice an error instead of silently part of the choice).

### Next

M2-14 (e2e for all card types and Markdown, add Firefox and WebKit to CI, QA risk R-1), M2-15 (release pipeline, publication needs approval), M2-16 (the M2 gate: QA report, security review, image scan, `v0.1.0` only after approval).

### Things to know

- Anything that reformats Markdown (Prettier, editors with format-on-save) can break a Markdown deck. The repo ignores `examples/*.md` for that reason.
- The skill defaults to Markdown output with a four-backtick outer fence for decks that contain code. If Claude gets that wrong in practice, change the skill, not the parser.
- Diagrams and highlighting have only been run in Chrome. Firefox and WebKit are M2-14.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, screen readers untested, no favicon).

## Handoff history

### 2026-10-11: SDE, M2-12, to the owner

The API token (ADR-009, ADR-011). See the SDE log section "M2-12".

### 2026-10-11: SDE, M2-11, to the owner

Diagrams and code highlighting under the unchanged policy (ADR-010). See the SDE log section "M2-11".

### 2026-10-11: SDE, M2-09 and M2-10, to the owner

Import preview detail and the typed and choice study screen. See the SDE log section "M2-09 and M2-10".

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
