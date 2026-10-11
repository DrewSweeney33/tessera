# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-14, end-to-end coverage and cross-browser CI)
**To:** The owner (approve the push, then watch the first CI run), then the SDE for M2-15
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (section "M2-14")

### Result

A keyboard-only test covers import and all four card types. The e2e suite now runs in WebKit as well as Chrome (118 tests each, all passing), and CI has a new `browsers` job for Firefox and WebKit. **Firefox has never run**: it will not start on this Windows machine, so its first run is in CI.

### State of git

M2-05 to M2-13 are on GitHub. M2-14 is committed locally and **not pushed**.

### Needs the owner

1. **Approve the push**, then **watch the first CI run**. The new Firefox job may fail on something I could only read and not run. If it does, tell me, or say "keep pushing CI fixes" and I will fix and push (the standing approval covers CI fixes).
2. If you want Firefox tested locally too, the cause is the `firefox.exe` side-by-side error. It needs administrator tools (or a repair of the Visual C++ runtimes) that I did not use.
3. Safari on a real Mac or iPhone is still untested. Playwright's WebKit is the same engine, not the same product.

### Next

M2-15 (release pipeline, publication needs your approval) and M2-16 (the M2 exit gate: QA report, security review, image scan, then `v0.1.0` only after your approval).

### Things to know

- Safari does not Tab to links by default, so a keyboard user there uses Option+Tab for links. Documented in the README. Tests focus links directly in WebKit.
- A test loop that acts on "the card on screen" can act on the card just answered, which stays visible with disabled buttons until the next arrives. Wait for the grade buttons to go. Two tests had this.
- `test:e2e:all` runs Chrome, Firefox, and WebKit in turn and stops at the first failure, so on this machine it stops at Firefox.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, screen readers untested, no favicon, the skill untried in a real conversation).

## Handoff history

### 2026-10-11: SDE, M2-13, to the owner

The Claude skill, format reference, workflow guide, and golden decks. See the SDE log section "M2-13".

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
