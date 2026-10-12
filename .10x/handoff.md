# Handoff

## Current handoff

**From:** SDE, QA, and DevOps, the 0.1.1 work and the live-image harness
**To:** The owner (approve the final 0.1.1 after the real-host run), then the SDE for M3
**Date:** 2026-10-11
**Per-feature file:** `.10x/decisions/sde/tessera-v1.md` (section "0.1.1"), `.10x/specs/2026-10-11-v0.1.1-and-live-test-design.md`, `.10x/adrs/012-live-image-test-harness.md`, `docs/testing-on-your-host.md`

### Result

0.1.0 is released and runs on the homelab (CT123, `https://tessera.sweentech.com`). Testing the real image on that host found real things, and 0.1.1 fixes them: the backups folder missing on a fresh install (B-1), a generic 500 when the data disk is full (now a plain 507), the Svelte logo in the browser tab (now Tessera's mark), unrotated container logs, and a deploy guide that only showed building from source. The new live-image harness (`npm run live:test`) runs the real image as a throwaway test instance on a Docker host over SSH and never touches the instance the owner uses. The security probe's remote mode no longer skips about 90 checks silently.

### State of git

All 0.1.1 work is pushed (`5c20def`, version `0.1.1-rc.1`). CI on that commit decides the next step. The owner approved a release candidate: tag `v0.1.1-rc.1` once CI is green. A candidate publishes only the exact image tag `ghcr.io/drewsweeney33/tessera:0.1.1-rc.1` (never `latest` or `0.1`) and a GitHub pre-release. The final `0.1.1` still needs the owner's approval.

### Needs the owner

1. **After the candidate is published:** the harness runs against that exact image, soak included. If it is green, say "release 0.1.1" and I bump the version, rename the changelog section, push, wait for CI, and tag.
2. **Upgrade CT123 when 0.1.1 is out:** change the image tag in `/opt/tessera/compose.yaml`, `docker compose pull`, `docker compose up -d`. On 0.1.0 the manual backup needs `docker compose exec tessera mkdir -p /data/backups` once.
3. **Port 3000 on CT123 is reachable from the LAN directly** (confirmed from the owner's PC), which skips NPM's "Internal Only" Access List. An OPNsense rule that lets only NPM reach 192.168.30.102:3000 would close it. Not an application change.
4. **About 544 MB of Docker build cache is left on CT123** from the build that hung. Read-only first: `docker builder du`. To remove it: `docker builder prune -f` (it is cache only).
5. Still open from the M2 exit, unchanged: use the skill in a real Claude conversation (R-9), a screen reader pass (R-3), try it on a phone (R-10), accept or reject security findings S-10 and S-04, a multi-day soak (R-8). The disk-full risk (R-7) is now tested on the real host and handled.

### Next

M3 (leeches, weak spots, export, settings) after 0.1.1. Every release from now on gets a harness run recorded in its QA report (ADR-012).

### Things to know

- The harness's test folder is `~/tessera-test` in the SSH user's home and its Compose project is `tessera-test`. It refuses to use the live port or a live folder with that name, and always tears down.
- Building the image on CT123 hung in `npm prune` (a slow route to the npm registry from that container, cause not found). Use a published image with `--image`; `--build` now cancels a hung build after 15 minutes.
- `docker kill` is a manual stop to Docker, so it does not restart the container. The harness simulates a crash by killing the server process inside it.
- The runtime image has no npm, corepack, or yarn (removed on purpose). A failed image scan only reports findings that have a fix.

## Handoff history

### 2026-10-11: QA and Security, Milestone 2 exit, to the owner

Both exit reports written (no blocking defects), and `v0.1.0` tagged on the owner's approval after CI was green on `ad6fb23`. See `.10x/reviews/2026-10-11-qa-report-m2.md` and `2026-10-11-security-review-m2.md`.

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
