# SRE Decisions: tessera-v1

**Date:** 2026-10-11
**Phase:** 6 Delivery, SRE. Upstream: DevOps decisions and ADR-008, the QA report, the security review.
**Runbooks:** `docs/operations.md` (and `docs/deploy.md`).

## System and failure domains

One Node process (SvelteKit with adapter-node) and one SQLite file in WAL mode, in a container, on one host. No network dependencies, no queue, no cache, no external API. The failure domains are the process, the data volume, the host, and the operator. There is no redundancy and no failover, deliberately: one user, one machine.

## Reliability posture found

No monitoring beyond the Docker health check, no defined service levels, no incident history (nothing has run yet), and no runbooks. The code already had structured logs, request ids, graceful shutdown, a pre-upgrade backup, and a health endpoint that touches the database.

## Service levels

For a single user the useful indicators are about the data and about being fast enough, not about uptime.

| SLI | SLO | Measured on the real build |
|---|---|---|
| Acknowledged grades lost by an application crash or restart | Zero | Zero across SIGKILL after an acknowledged grade, SIGKILL during a 5,000 card import (ten kill times), restart, and 8 simultaneous grades for one card. |
| Fraction of API calls under 250 ms | 95 percent | 100 percent. Median 20 ms and 99th percentile 34 ms under a sustained 140 requests a second. 9 to 14 ms with five years of history. |
| Time to recover from a damaged or missing database, given a backup | Under 10 minutes by hand | The restore itself takes about a second. The steps are in the guide. |
| Backup freshness | At most 7 days old | Not measured by the app. The operator's job. See gaps. |
| Server errors (5xx) in normal use | Zero | Zero in 24,831 requests. |

**Error budget.** For a hobby service the practical rule is: any lost grade, or any restore that does not work, stops feature work until fixed. Slowness and brief downtime do not.

**Power loss.** The one place the first target does not hold is a power cut or operating system crash. With `synchronous = NORMAL` in WAL mode, the file stays consistent but the last few commits can be lost. Accepted (ADR-001) because a lost grade costs the learner seconds of effort, and `FULL` would add a disk flush to every grade. Documented in the guide. Revisit if users report it.

## Failure modes

Likelihood is for a typical homelab user. "Evidence" is what was actually run.

| Failure | Likelihood | Impact | How you notice | Recovery | Evidence |
|---|---|---|---|---|---|
| Process crash or kill | Low | Brief outage, no data loss | Docker marks it unhealthy, restart policy brings it back | Automatic | SIGKILL tests, restart tests |
| Host reboot | Medium | Brief outage | Container restarts with the host | Automatic (`restart: unless-stopped`) | Restart tests. The compose policy itself was not run. |
| Power cut or OS crash | Low | Last few commits possibly lost, file consistent | Nothing visible | None needed | Reasoned from SQLite's WAL guarantees. Not simulated. |
| Wrong environment variable | Medium (first install) | Will not start | Log names the variable | Fix and restart | Four variables tested, messages recorded |
| Data folder not writable (bind mount ownership) | High (first install) | Will not start | Log gives the exact `chown` | Run the command | Tested with an unusable path |
| Database damaged or truncated | Low | Will not start, file untouched | "damaged or is not a Tessera database" | Restore a backup | Garbage file and half-file both tested, bytes unchanged |
| Damage deep inside the file, header intact | Very low | Some requests fail while `/healthz` stays green | Errors in logs | Restore a backup | **Not tested. Gap.** |
| Disk full | Low | Writes fail, reads work | Errors in logs, "SQLITE_FULL" | Free space (old backups) | Message from code. **Not triggered. Gap.** |
| Upgrade breaks the database | Low | Will not start | Health check, log | Restore the automatic pre-upgrade backup | Pre-upgrade backup exists and is tested. Restore tested. |
| Rollback to an older image | Medium | Would have silently used a newer schema | Now: refusal with a message | Restore the pre-upgrade backup or start the newer version | Fixed and tested (ADR-008) |
| Old and new container overlap during upgrade | Medium | Was: 47 of 60 writes failed | Was: "database is locked" errors | Now handled | Fixed and tested at process level (60 of 60 succeed) |
| Operator copies the live database file as a backup | Medium | Backup is empty or missing days of history | Only when restoring | Use the snapshot command | Shown: copy had no tables. Warned in guide. |
| No backup exists when needed | Medium | Permanent loss | Only when needed | None | **Gap**: nothing alerts on a stale backup. |
| System clock steps backwards | Low | Was: a card unanswerable for the size of the step | Repeated "answered somewhere else" notice | Now handled | Reproduced, fixed, regression test |
| Two browser tabs or devices grade the same card | Medium | Second one is told it is stale | Notice in the UI | Automatic | Tested in the browser and with 8 parallel grades |
| Lost connection during a grade | Medium | Answer not saved, or saved but unconfirmed | Error with Try again | Retry reuses the review id, counted once | Tested both cases |
| Hostile or malformed deck | Medium | Rejected or neutralized | Import error list | None needed | Security review: 101 probe checks, XSS corpus |
| Memory growth over days | Unknown | Slow degradation, possible OOM kill | Container restarts | Restart | 3 minute soak flat at 313 MB. **Days-long soak not run. Gap.** |
| Two copies of Tessera on one folder | Medium | None now | None | None | Tested: no errors, integrity ok |
| Port already in use | Medium | Will not start | `EADDRINUSE` in the log | Change the port | Tested |

## Monitoring and alerting

**What exists.** A Docker health check on `/healthz` (30 second interval, 3 retries), one JSON log line per request with a request id, error lines for anything unexpected, a startup line with database path and migrations applied, and a shutdown line.

**What is recommended, in order of value.**

1. Rely on the Docker health check and restart policy. It needs nothing.
2. If the operator already runs an uptime monitor (Uptime Kuma, healthchecks), point an HTTP check at `/healthz` expecting 200. Alert after three consecutive failures. This is the only alert worth sending.
3. A daily cron job that runs the snapshot command and copies the file off the machine. Alert if the job fails or the newest backup is older than 7 days.
4. Optionally watch free space on the volume (alert above 85 percent).

**What is deliberately not done.** No metrics endpoint, no dashboards, no tracing, no alert on CPU or memory. A single-user service does not justify them, and "alert on symptoms" rules out resource alerts. A `/metrics` endpoint can be added in a later milestone if a user asks.

**Gaps in observability.** The app cannot tell the operator when a backup is stale, because it does not know about backups taken outside it. `/healthz` checks that the database answers, not that every table is readable.

## Runbooks

All in `docs/operations.md`, written from the failures above: health and logs, what good looks like, resource use, backups (automatic and manual), restore, upgrade, roll back, and a table of every startup message with its fix.

## Production readiness assessment

| Question | Answer |
|---|---|
| Can the owner run this on their homelab today? | **Yes**, on loopback or a VPN, with a daily snapshot copied off the host. Not yet on an open network (security S-01 and S-02). |
| Will it stay up? | A crash or reboot recovers without data loss. There is no day-scale soak evidence yet. |
| Can it be recovered? | Yes. Backup, restore, upgrade, and rollback were each run, and a script re-runs them in CI. |
| Would an operator know what is wrong? | Yes for startup failures (messages name the cause and fix). Less so for silent deep corruption and disk-full during use. |
| Is it ready for a public `v0.1.0`? | **No, by design.** That gate is the end of M2. Before it: a green CI run including the container, the host check (S-01), a decision on S-02, a Linux run of the new scripts, and an image scan. |

**Sign-off for Phase 6 (delivery readiness of the M1 slice): conditional.** Ready for the owner's own trial use. The release itself waits on the conditions above and on the owner's approvals (GitHub remote, license, publication).

## Gaps and recommendations

| # | Gap | Recommendation | When |
|---|---|---|---|
| G1 | No evidence from Linux or Docker | First CI run, then `docker compose up` on the homelab | Before M2 work builds on it |
| G2 | Deep mid-file corruption would not trip `/healthz` | When `GET /api/backup` is built (M3), have it run `integrity_check` and report it. Consider a deeper health query | M3 |
| G3 | Disk-full behaviour not triggered | Test with a size-limited volume on Linux | M2 exit |
| G4 | No soak longer than 3 minutes | Run the existing soak for 12 to 24 hours on the homelab and watch memory | M2 exit |
| G5 | No stale-backup signal | Documented cron plus uptime-monitor heartbeat. Possibly show "last backup" in the UI in M3 | M3 |
| G6 | Pre-upgrade backups never pruned | Document (done). Consider keeping the last N | M3 |
| G7 | No graceful-shutdown check on Windows | Covered on Linux by the container job | First CI run |

## Handoff

To the owner: the deployment guide, the operations guide, the release process, and the changelog are in the repo. Escalation path: there is none beyond the owner. Dashboards: none. Log queries are in the guide.
