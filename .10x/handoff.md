# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-15, the release pipeline)
**To:** The owner (approve the push, then watch the first CI run), then the SDE for M2-16
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (sections "M2-14 follow-up" and "M2-15"), `docs/releasing.md`

### Result

The release workflow now attaches the deck schema, the Claude skill as a zip, and checksums to a release, and the CI image job scans the built image for fixable high or critical vulnerabilities. Nothing was published or tagged. The previous push (M2-14) was fully green in CI, including Firefox on its first run.

### State of git

Everything through M2-15 is on GitHub and CI is fully green on ad454a0 (Verify, Firefox, WebKit, Docker amd64 with the image scan, Docker arm64). The first run after M2-15 failed three ways (an e2e race in the LAN-address test, then a hang in `allHeaders()`, and real scan findings in npm/corepack/yarn); all are fixed. See the SDE log, "M2-15 follow-up".

### Needs the owner

1. **Run the release workflow by hand once** (Actions, Release, Run workflow, on `main`) before the real tag, to see the new asset step pass. It publishes nothing. The version in `package.json` is `0.0.1` and the changelog has no `0.0.1` section, so the rehearsal's version check will fail on `main`; use a short-lived branch as `docs/releasing.md` describes, or wait for M2-16, which sets the version.
2. **Confirm Settings, Actions, General, Workflow permissions** allows the release job to push packages (still unverifiable until a real tag).

### Next

M2-16, the Milestone 2 exit gate: repeat QA and security review, the disk-full and long soak runs on the homelab, set the version and move the changelog, and tag `v0.1.0` **only on your approval**. Before that the QA report, a fresh security review, and your try-out of the skill and the decks are needed.

### Things to know

- The runtime image has no npm, corepack, or yarn (removed on purpose, ab21775). Anything that needs npm at runtime must be done in the build stage.
- A failed image scan is meant to be actionable: it only reports findings that have a fix. Do not add a `.trivyignore` without recording why.
- The release zip is reproducible, so a checksum can be rebuilt and compared from the tagged source.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, screen readers untested, no favicon, the skill untried in a real conversation).

## Handoff history

### 2026-10-11: SDE, M2-14, to the owner

Keyboard-only test, and Firefox and WebKit in CI. Passed in CI on its first run. See the SDE log section "M2-14".

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
