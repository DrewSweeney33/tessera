# DevOps Decisions: tessera-v1

**Date:** 2026-10-11
**Phase:** 6 Delivery, DevOps. Upstream: QA report and security review of 2026-10-11, ADR-004, ADR-005, ADR-007. New: ADR-008.

## Current setup (mapped before changing anything)

| Area | State at the start of this phase |
|---|---|
| Hosting | None yet. Self-hosted by users. The owner runs it on a homelab host. |
| Container | Multi-stage Dockerfile on `node:24-trixie-slim`, non-root, health check. **Never built** (no Docker locally). |
| Compose | Loopback publish, read-only root, no capabilities, named volume. Never run. |
| CI | `ci.yml`: verify, audit, licenses, build and smoke, browser tests, benchmark, security probe, durability check, and a container job for amd64 and arm64. **Never run** (no remote). |
| Release | None. |
| Remote | None. Nothing is pushed or published without the owner's approval. |
| Operators | One person. |

## Problem

The slice works and is well tested, but nothing existed to ship it, upgrade it, back it up, or recover it, and several failure behaviours were untested. The plan gates `v0.1.0` at the end of M2, so this phase delivers a tested **delivery package** now and leaves the actual release for the M2 exit.

## Approaches considered

| Option | Verdict |
|---|---|
| Publish an `:edge` image from every push to `main` | Rejected for now. It publishes untagged software continuously, and nothing could be verified before the first CI run. Revisit after the first green run. |
| Hosted deployment (Fly, a VPS) | Rejected. The product is self-hosted by design. |
| **Tag-driven release that reuses CI, plus operations docs backed by a script that proves them** | **Chosen.** Cheapest thing one person can keep correct. |

## Decisions

1. **Pipeline.** `ci.yml` is also a reusable workflow. `release.yml` runs on a pushed `vX.Y.Z` or `vX.Y.Z-suffix` tag, or by hand as a rehearsal. It calls CI first, then checks the tag against `package.json` and the changelog, then builds `linux/amd64` and `linux/arm64`, pushes to `ghcr.io/<owner>/tessera` with provenance and an SBOM, and creates the GitHub Release from the changelog. Read-only permissions by default, write access for the publish job only. Release candidates get only their exact tag. Stable versions also get `major.minor` and `latest`.
2. **Deployment strategy.** Replace in place: stop the old container, start the new one (`docker compose up -d --build`). Blue/green and canaries make no sense for one user and a single-writer database. Overlap is made safe by ADR-008 anyway.
3. **Rollback.** Stop, start the previous version. If the database was migrated, the old version refuses to open it and says to restore `/data/backups/pre-migrate-<timestamp>.db`. Tested at process level.
4. **Backups.** Automatic before schema changes. Manual snapshot with a documented command that is safe while running, run by `npm run ops:check` from the text of the guide. A plain copy of the live file is documented as unsafe (a fresh database copied this way had no tables).
5. **Versioning.** SemVer, `0.x` until the end of M5. The version in `/healthz` comes from `package.json`, so the release checklist bumps it before tagging.
6. **Environment and config.** Documented in `docs/deploy.md`. `TZ` should be set. The token and host allow-list variables are reserved and inert until M2.
7. **Access.** The deployment guide ranks private network (Tailscale, WireGuard), then a password-protecting reverse proxy, then LAN exposure. It states the DNS rebinding gap (security S-01) plainly.
8. **Supply chain.** All seven actions used are pinned to SHAs. The four from CI were checked against upstream tags on 2026-10-11 and match. The three added for release (`login-action` v4.6.0, `metadata-action` v6.2.0, `build-push-action` v7.4.0) were looked up from upstream. Image scanning is not in the pipeline yet.

## Risk assessment

| Risk | Blast radius | Handling |
|---|---|---|
| The release workflow publishes something wrong | A bad image under a version tag | Runs only on a deliberate tag; CI first; changelog and version checks; rehearsal mode; documented recovery in `docs/releasing.md` (publish a patch, do not move tags). |
| The image does not build or fails on arm64 | Cannot ship | Found by the first CI run, which is the first item on the checklist. Nothing has been published. |
| Upgrade fails midway | Possible downtime | Automatic pre-upgrade backup; documented restore; old version refuses a newer database instead of corrupting it. |
| Operator copies the live database file | Silent data loss in the backup | Documented warning, and a check proves the failure is real. |
| Workflow shell steps are wrong | Release fails or has empty notes | Their `run:` text was extracted and executed against good and bad inputs. This found a regular-expression dot bug and an empty-notes edge case, both fixed. |

## What was verified, and what was not

| Verified here (Windows, Node 24, real built server) | Not verified |
|---|---|
| 50 browser tests, 28 smoke, 101 probe, 54 durability, 26 operations checks, benchmark, 332 unit and 238 integration tests, licenses, audit | `docker build` of the image and its size against the 150 MB budget |
| Workflow YAML parses and passes policy tests (pins, permissions, triggers, tag-only publishing) | Any workflow actually running on GitHub, on either architecture |
| The release workflow's version check and notes extraction, run for real on stable, release-candidate, mismatched, missing, and empty cases | The `docker/*` actions, GHCR login, attestations, `gh release create` |
| Pinned SHAs match upstream tags | Linux behaviour of the new scripts (graceful SIGTERM, file permissions, bind mounts) |
| Backup, restore, damaged and truncated database, newer database, bad config, busy port, two copies on one folder | The `docker compose` wrappers around those commands |

## Rollout plan

1. Create the GitHub repository (owner decision) and push `main`. Read the first CI run end to end. Fix what Linux and Docker reveal. This is the first real test of the container.
2. Rehearse the release workflow with **Run workflow**.
3. Continue M2. At the M2 exit, repeat QA and security review, bump the version, move the changelog, and push `v0.1.0`.
4. Add an image vulnerability scan to the release job and consider a base image digest pin.

## Handoff to SRE

Deploy and recover with `docs/deploy.md` and `docs/operations.md`. Rollback is described in both and in ADR-008. Release steps are in `docs/releasing.md`. No environment URLs exist yet.
