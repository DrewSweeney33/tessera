# Handoff

## Current handoff

**From:** DevOps Engineer and SRE, Phase 6 Delivery (readiness of the M1 slice)
**To:** The owner (decisions and approvals), then the SDE for M2
**Date:** 2026-10-11
**Per-feature files:** `.10x/decisions/devops/tessera-v1.md`, `.10x/decisions/sre/tessera-v1.md`, `.10x/adrs/008-forward-only-migrations-and-write-locking.md`

### Result

A tested delivery package exists. **Nothing has been released, tagged, pushed, or published.** `v0.1.0` stays at the M2 exit, as planned. The sign-off is conditional: the M1 slice is ready for the owner's own use behind loopback or a VPN, with a daily snapshot copied off the host. It is not ready for a public release.

Four reliability bugs were found by running failures against the real server and fixed (ADR-008): two copies on one data folder failed 47 of 60 writes, an older version silently opened a newer database, a damaged database gave no guidance, and a backwards clock step could make a card unanswerable.

### What exists now

| Item | Where |
|---|---|
| Deploy guide (access options, settings, data, safety) | `docs/deploy.md` |
| Operations guide (health, logs, backup, restore, upgrade, rollback, every startup message and its fix) | `docs/operations.md` |
| Release process and first-release checklist | `docs/releasing.md` |
| Changelog (the `[Unreleased]` section describes the M1 slice) | `CHANGELOG.md` |
| Vulnerability reporting policy | `SECURITY.md` |
| Tag-driven release workflow (runs CI first, multi-arch, provenance and SBOM, release notes from the changelog) | `.github/workflows/release.yml` |
| Script that runs the operations guide's backup command as written and checks every documented message | `npm run ops:check` |
| Capacity and soak numbers | `docs/performance.md` |

### Tools

`npm run verify`, `npm run build` then `test:e2e`, `smoke`, `security:probe`, `durability`, `ops:check`, `benchmark`. CI runs all of them. The soak and process experiments used for the SRE numbers were scratch scripts and are not in the repo.

### What to do next, in order

1. ~~GitHub setup~~ **Done 2026-10-11.** The repository `DrewSweeney33/tessera` is public, CI is green on Linux including both container jobs, the license is AGPL-3.0-only, private vulnerability reporting is on, and the release workflow was rehearsed successfully. Details in `.10x/status.md` under "GitHub setup results". The first CI run found two bugs in my own tests (a race and a measure-before-the-page-exists), both fixed. CI retries are off on purpose.
2. **M2-00 (SDE):** the host check against DNS rebinding (security S-01), with a safe default. Flip the probe check from KNOWN to PASS.
3. **Owner decision S-02:** how the API token works with the web UI. Then amend ADR-005 and do M2-12.
4. Continue M2 from M2-01.
5. **At the M2 exit:** repeat QA and security review, add the image scan, run disk-full and a 12 to 24 hour soak on the homelab (SRE gaps G3, G4), bump the version, move the changelog, tag `v0.1.0`.

### Residual risks

The registry push and GitHub Release creation have never run (only a real tag does them). The `docker compose` wrappers in the guides were not executed on a real host. Disk-full not triggered. Deep mid-file corruption would not turn `/healthz` red (backups should be integrity-checked; planned with `GET /api/backup`). Chrome only. No real screen reader pass. Nothing alerts on a stale backup.

### Lessons to keep applying

- Run the failure before writing the runbook. Four of the five most important findings in this phase (overlap, downgrade, damaged file, clock step) were invisible until triggered.
- Windows Git-bash mangles backslashes in arguments. Write shell steps without backslash escapes so they behave the same everywhere.
- PowerShell double-quoted here-strings eat backticks. Write Markdown with the Write tool.
- A mutation that removes one of two redundant conditions proves nothing. Make the mutation decisive.
- Do not copy a live SQLite file. Use the snapshot command.

### Open items that need the owner

1. **Confirm the M1 exit gate** so M2 can begin.
2. **Merge Dependabot pull request #2** (`setup-node` 7.1.0). Verified safe: the pinned SHA is the `v7.1.0` tag and the full CI passed.
3. **S-02:** how the API token should work. Recommendation in `.10x/status.md`.
4. **Try the guides once on your own host**, or install Docker Desktop here so the compose commands can be run.
5. Before the first real tag: check that Settings, Actions, General, Workflow permissions does not block the release job's `packages: write`.

Resolved on 2026-10-11: GitHub remote (public), LICENSE (AGPL-3.0-only), private vulnerability reporting, the release rehearsal, and the five Dependabot pull requests (four closed, one pending the owner's merge).

**Standing approval:** the owner allowed pushing CI fixes to `main` of this repository without asking each time. Everything else, including documentation, dependency and license changes, still needs approval first.

## Handoff history

### 2026-10-11: QA Engineer and Security Engineer, Phase 5 interim verification, to SDE, DevOps, and the owner

The M1 slice was sound. Two defects fixed (no h1 on the study screen, oversized chunked body gave 500). 14 of 15 injected bugs caught by the tests; the survivor (CSP loosening) is now covered by the security probe in CI. Two medium security items scheduled: S-01 DNS rebinding as new task M2-00, S-02 token versus UI as an owner decision. Reports in `.10x/reviews/2026-10-11-qa-report.md` and `2026-10-11-security-review.md`.

### 2026-10-10: SDE, end of Milestone 1, to the next session

All 23 M1 tasks done and verified. Backend, UI ("Tessera Desk" design), 20 browser tests, README and docs, benchmark, and CI steps in place. Decisions recorded: ADR-006 (JSON-only UI), ADR-007 (install scripts off), ADR-003 refinement (learn-ahead is a last resort), fonts as static files, `theme-init.js` for no flash, located JSON syntax errors.

### 2026-10-10: SDE, mid-Milestone 1, to the next session

16 of 23 tasks done: the whole backend (schema, parser, import, scheduler, queue, submitReview, routes, container, CI). UI tasks, e2e, benchmark, and docs remained.
