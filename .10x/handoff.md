# Handoff

## Current handoff

**From:** QA and Security, Milestone 2 exit (M2-16 evidence)
**To:** The owner (decisions and checks only they can do), then the SDE to tag `v0.1.0` on approval
**Date:** 2026-10-11
**Per-feature file:** `.10x/reviews/2026-10-11-qa-report-m2.md`, `.10x/reviews/2026-10-11-security-review-m2.md`, `.10x/decisions/sde/tessera-v1.md`, `docs/releasing.md`

### Result

Both exit reports are written. **No blocking defects, no open finding above Low.** Both M1 medium security findings are closed. CI is green on ad454a0 (Verify, Firefox, WebKit, Docker amd64 with the image scan, Docker arm64). Evidence: 884 unit and 346 integration tests, 118 browser tests on each of three engines, 215 probe checks, durability, smoke, benchmark (5,000 cards in 1.18 s), 0 production vulnerabilities, a four minute soak (54,338 requests, 0 errors, memory flat). A mutation check of 26 deliberate bugs in the new logic found 3 real test gaps, now closed. Nothing was tagged or published.

### State of git

Pushed: everything through the state commit 1884089. **Local only, not pushed:** the test additions and the two reports (committed), and **uncommitted in the working tree:** the version bump to 0.1.0 (`package.json`, `package-lock.json`) and the CHANGELOG section `## [0.1.0] - 2026-10-11` (edit the date if the tag lands on another day). Full `npm run verify` passes with these, and the release assets build for 0.1.0.

### Needs the owner

1. **Quickstart on the homelab** with `docker compose up`, time it, try the wrapper scripts (R-2).
2. **Use the skill in a real Claude conversation**: make two decks, import them, study them (R-9). Look at the example decks' facts too.
3. **Rehearse the release workflow** on a short-lived branch (docs/releasing.md), and check Settings, Actions, General, Workflow permissions allows pushing packages (R-11).
4. Decide the security review's open items: write `docs/security.md` or amend ADR-005 (S-08, I can draft it), approve log rotation in `compose.yaml` (S-11), accept S-10 and S-04.
5. Recommended, not required: a screen reader pass (R-3), a disk-full run on a small volume (R-7), leave an instance running for days (R-8), try it on a phone (R-10).
6. **Say "tag v0.1.0"** when satisfied. Then: commit the version bump and changelog, push, wait for CI, tag, watch the release workflow.

### Next

M3 (leeches, weak spots, export, settings) after the tag, or before it if you prefer to keep building while you try things out.

### Things to know

- The runtime image has no npm, corepack, or yarn (removed on purpose, ab21775).
- A failed image scan only reports findings that have a fix. Do not add a `.trivyignore` without recording why.
- The token is not a login (QA/security review explains what it does and does not do).
- Idle memory is about 256 MB and about 315 MB under load, on Windows.

## Handoff history

### 2026-10-11: SDE, M2-15, to the owner

Release pipeline and image scan. CI went green after three fixes. See the SDE log, "M2-15" and "M2-15 follow-up".

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
