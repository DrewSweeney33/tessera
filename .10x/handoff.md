# Handoff

## Current handoff

**From:** The team (SDE, QA, Security, DevOps), end of Milestone L and Milestone 3
**To:** The owner
**Date:** 2026-10-12
**Per-feature files:** `.10x/reviews/2026-10-12-qa-report-milestone-l.md`, `.10x/reviews/2026-10-12-security-review-milestone-l.md`, `.10x/decisions/sde/tessera-v1.md` (sections from "L-01" to "L-08 Backups, L-09 restore, L-10 harness"), `.10x/adrs/013-*.md`, `.10x/adrs/014-*.md`, `CHANGELOG.md` ([Unreleased])

### What was done

**Milestone 3 (added after you said "Lets continue").** Leeches and the weak-spot loop are built: a Leeches page (the cards you keep forgetting, with the wrong answers you typed; Reset, Set aside, Put back), your weakest tags, and **Copy the weak-spot report for Claude**, which puts your worst cards on the clipboard as ready-to-edit deck blocks in the import format with a request to rewrite them, keeping every id and type. Claude's answer imports as usual, updates only those cards, and keeps their history. Also a Settings page (new cards per day, reviews per day, target retention, the hour the day starts, the leech threshold, mixing new and due cards), and the mixing option now really mixes. ADR-015 records the design; the review is `.10x/reviews/2026-10-12-m3-qa-and-security.md`. Pushed to `main`, CI green through the leech work. **CT123 does not have the Milestone 3 work yet** (it has the library work, built from commit 3d00272); say so and I will put the new build on it.

**Milestone L,** from earlier:

Milestone L is built, pushed to `main`, and tested: **L-01 to L-10, including the stretch (L-09 restore)**. In the web page you can now make a deck, edit any card with a live preview, add and remove cards, export a deck, move a deck to the Trash and restore it or delete it for good, start a deck over, back up now, download and delete backups, and restore a backup. Nothing is released. `[Unreleased]` in the changelog lists all of it. Your live Tessera on CT123 still runs 0.1.1, which has none of this.

Checks, all passing on the last commit: 1,736 unit and integration tests, 217 browser tests on each of Chromium and WebKit, an accessibility scan of every new state in light and dark, layout at phone widths, and about 490 security probe checks. The live-image harness ran on CT123's Docker (test project only, `~/tessera-test`) against an image built from the code: **106 passed, 0 failed**. That run included the restore (the server stopped itself, Docker restarted it, the data was the backup's) and an upgrade from 0.1.1 with a rollback.

### What needs you

1. **Choose the version and say when to cut a release candidate.** This is the first release with a database change (`0001_deck_resets`), so semver says **0.2.0**. Nothing has been tagged. The CI image build runs on tags, so a candidate such as `v0.2.0-rc.1` is the way to get a published image to test on CT123 before the final release (the harness has to be run against the published candidate: `TESSERA_LIVE_SSH=andrew@192.168.30.102 npm run live:test -- --image ghcr.io/drewsweeney33/tessera:0.2.0-rc.1 --expect-migration`).
2. **Read the two accepted risks in the security review (S-11, S-12).** Anyone who can reach the page can delete a deck for good, delete a backup, or restore an older backup (which restarts Tessera). The typed word protects against a slip, not a person. Keep it behind your VPN or NPM Access List as now. Say if you want an optional page password or a limit on backups, or leave them as accepted.
3. **Upgrading CT123 later** is the usual tag change and pull. Because of the migration, Tessera writes a `pre-migrate-…` backup first. Going back to 0.1.1 after that means restoring that backup (the operations guide, "Roll back"). The harness tested exactly this.
4. **Try the report on real leeches, then tell me what Claude got wrong in how it answered.** The instruction wording is a first draft (the review has the details).
5. **Restore needs the restart policy** (`restart: unless-stopped` in `compose.yaml`). CT123's compose file has it. If you ever run without one, the page says what to do.
6. **Still open from before:** the OPNsense rule so only NPM reaches 192.168.30.102:3000, clearing the build cache on CT123, a daily off-box backup copy (the Backups page now makes the download easy, but a scheduled copy is still yours), Uptime Kuma, the VLAN/host/Pi-hole/firewall notes for CT123 in the vault, trying the Claude skill in a real conversation (R-9), a screen reader and phone pass (R-3, R-10), and a multi-day soak (R-8).

### Next, once you decide

- Cut the release candidate, run the harness against it, then release 0.2.0 on your word.
- Then Milestone 4: "Practice again" (cram mode, the other half of US-14: grades never change the schedule) and statistics (today, retention, a forecast, a streak, per-tag retention). After that, Milestone 5 (polish and the rest of the plan). The checkpoint rule (5 study days) was overridden by your "next milestone", so the order is yours.
- Backlog: B-3 (chunked oversized bodies reset the connection), B-4 (reorder cards in the editor).

### Things to know

- **The image build on CT123 used to hang in `npm prune`.** The Dockerfile now installs the runtime modules in their own stage with `npm ci --omit=dev`, and building on that host takes seconds. The cause of the hang itself was not found.
- The harness works only in `~/tessera-test` and never touches `/opt/tessera`. It now uses six ports (3001 to 3006) and a `previous`/`upgraded` pair of services for the upgrade test.
- A release candidate tag publishes only its exact tag and a pre-release.
- Restoring from the page stops the server with SIGTERM, which Windows cannot deliver, so it is a container feature.

## Handoff history

### 2026-10-12: the team, the overnight run, to the owner

0.1.1 released and verified on the real host; the competitor re-check and the M3 re-plan written; the library requests became user stories US-11 to US-16 with ADR-013 and ADR-014 (Proposed). The owner then upgraded CT123 to 0.1.1, accepted both ADRs, and said "next milestone", which overrode the checkpoint gate and started Milestone L.

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
