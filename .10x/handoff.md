# Handoff

## Current handoff

**From:** The team (SDE, QA, DevOps, PM, EM), after the overnight run of 2026-10-12
**To:** The owner (a few decisions and one upgrade), then the SDE
**Date:** 2026-10-12
**Per-feature files:** `.10x/reviews/2026-10-12-qa-report-0.1.1.md`, `.10x/decisions/sde/tessera-v1.md` (sections "0.1.1" and "0.1.1 released"), `.10x/decisions/engineering-manager/tessera-v1.md` ("M3 re-plan" and "Library management"), `.10x/decisions/product-manager/tessera-v1.md` (US-11 to US-16), `.10x/adrs/013-*.md` and `014-*.md`

### What happened overnight

- **0.1.1 is released** (stable, `v0.1.1`, image `ghcr.io/drewsweeney33/tessera:0.1.1`, with `0.1` and `latest` moved to it). It fixes what the first real deploy and the live-image harness found: the backups folder on a fresh install, a plain 507 answer when the data disk is full, Tessera's own tab icon, log rotation, and a deploy guide for the published image. It also ships the harness. The final image passed the harness on your real host again: 63 passed, 0 failed, 1 skipped.
- **Your live Tessera on CT123 is still on 0.1.0.** I did not touch it. The upgrade is yours (steps below).
- **M3 stays held at the checkpoint gate** (the CTO's rule: continue past M2 only after you have studied on 5 separate days with a Claude-generated deck). The M3 re-plan is written and the competitor re-check is done. It found Flash, a self-hosted FSRS app that Claude drives over MCP. Details are in the CTO file.
- **Your library management requests are in the plan, not built:** user stories US-11 to US-16, ADR-013 (editing, deleting, and resetting decks) and ADR-014 (backups and restore from the GUI), both **Proposed**, and tasks L-01 to L-10 (about 38 hours, about 32 net).

### Needs the owner

1. **Upgrade CT123 to 0.1.1.** On the LXC as `andrew`. 0.1.1 has no database change, so no migration runs.

   ```bash
   cd /opt/tessera
   sed -i 's#tessera:0.1.0#tessera:0.1.1#' compose.yaml
   grep image compose.yaml
   docker compose pull
   docker compose up -d
   docker compose ps
   curl -s http://192.168.30.102:3000/healthz
   ```

   `/healthz` should say version 0.1.1. The backups folder now appears on its own. To go back, change the tag to `0.1.0` and run `docker compose up -d`. The compose file on CT123 already has log rotation.
2. **Read and answer the five questions at the end of the product requirements** ("Owner requests added to the plan"): what "retrain after completion" means (the team assumed both practice again and start over), Trash before permanent delete, hand edits versus re-import, restore from the GUI now or later, and the order (library management before the weak-spot work is recommended). Then accept or change ADR-013 and ADR-014.
3. **Tell the team the checkpoint is met, or override it**, so the next milestone can start. The recommended next group is library management (L-01 to L-10), which is also what you need for daily use.
4. **List the other features you want.** The product file has a candidate list to cross out or promote.
5. **Optional cleanup on CT123**, all of it low risk: about 544 MB of Docker build cache from a hung build (`docker builder prune -f`, after `docker builder du` to look), and the cached candidate image (`docker rmi ghcr.io/drewsweeney33/tessera:0.1.1-rc.1`). The old 0.1.0 image can go after you have upgraded and are happy.
6. **Port 3000 on CT123 is reachable from the LAN directly**, which skips NPM's Access List. An OPNsense rule that lets only NPM (192.168.30.93) reach 192.168.30.102:3000 would close it.
7. **Still open from the M2 exit:** use the skill in a real Claude conversation (R-9), a screen reader pass (R-3), a phone check (R-10), accept or reject security findings S-10 and S-04, a multi-day soak (R-8), and a daily backup copy to another machine.

### Next, once you decide

Write nothing until you say so. Then: accept or change ADR-013 and ADR-014, start with L-01 (`exportDeck`), and keep each group test-first with a harness run on the real host in its QA report (ADR-012).

### Things to know

- The harness (`npm run live:test`, guide `docs/testing-on-your-host.md`) works only in `~/tessera-test` on the host and never touches `/opt/tessera`. Building the image on CT123 hangs (a slow route to the npm registry from that container), so test published images, or release candidates, with `--image`.
- A release candidate (`v0.1.1-rc.1`, for example) publishes only its exact tag and a pre-release, so it is the safe way to test unreleased code on the real host before a final release.
- The arm64 CI job runs under emulation and once stalled for over 20 minutes. A docs-only push replaced that run. A native ARM runner would remove it, and the owner has not asked for the change.
- The runtime image has no npm, corepack, or yarn (removed on purpose). A failed image scan reports only findings that have a fix.

## Handoff history

### 2026-10-11: SDE, QA, and DevOps, the 0.1.1 work, to the owner

0.1.1 built and tested: the backups folder, a plain disk-full answer, the tab icon, log rotation, the published-image guide, and the live-image harness. Release candidate `v0.1.1-rc.1` passed the harness on the real host. See `.10x/reviews/2026-10-12-qa-report-0.1.1.md`.

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
