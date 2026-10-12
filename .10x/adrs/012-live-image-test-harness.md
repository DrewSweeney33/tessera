# ADR-012: A live-image test harness that runs on a real Docker host over SSH

**Status:** Accepted
**Date:** 2026-10-11
**Feature:** tessera-v1
**Author:** 10x-Team (DevOps + QA + Architect)

## Context

CI runs the container image on a hosted runner. It cannot show how the image behaves on the homelab's Docker host (a nested Docker in an unprivileged LXC), behind a real network, with a real restart policy, a real disk, and the real compose file. The first real deploy (CT123, 2026-10-11) found a defect that CI missed (B-1: the backup folder did not exist on a fresh install, so the documented manual backup failed). Three risks from the M2 QA report can only be closed on a real host: compose behaviour (R-2), a full disk (R-7), and a long soak (R-8).

The scripts `smoke`, `security-probe`, and `benchmark` already accept `--base <url>`, but they write decks and grades, so they must never run against an instance that holds real study history. Running tests by hand on the live instance is also the one way to damage the data this project exists to protect.

## Decision

1. **A harness, `scripts/live-test.ts`, runs on the developer's machine** and drives a **throwaway test instance** on a Docker host reachable over SSH. The test instance is a compose project named `tessera-test` in a folder named `tessera-test` on that host, on its own port and with its own volumes. The live instance is never part of a test.
2. **Application tests run over HTTP from the developer's machine** (`smoke`, `security-probe`, `benchmark` with `--base`). **Docker-level tests run over SSH** (`docker inspect`, kill and restart, backup and restore with the documented commands, a size-limited tmpfs volume for a full disk, an optional soak with `docker stats`).
3. **Safety is enforced by the script, not by care.** It only works in a folder and compose project named `tessera-test`, writes a marker file there and removes only folders that have it, refuses the live instance's port and any volume shared with it, supports `--dry-run`, and always tears down in a `finally` block (and at the start of the next run). The SSH target comes from an environment variable, so the script is generic and holds nothing about one homelab.
4. **No check silently turns into a skip.** A check that cannot run in live mode is reported as SKIPPED with a reason, never PASS. The probe's checks that need the server's log read it over SSH. Its token and host-rule variants run against separate test projects the harness starts for them.
5. **The image under test is the published image for the version in `package.json`.** The harness prints its digest and compares it with the live container's digest.
6. **The harness is run on demand by the owner or, with the owner's permission given in conversation, by the assistant.** It is not part of CI (CI has no homelab).

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| A runner container on the Docker host, scripts run inside it | No firewall dependency, nothing on the developer's PC | Heavier to build, slower to iterate, tests no longer cross the real network | Decided against by the owner, who preferred the real network path |
| Docker Desktop on the development PC | Fast iteration | Not the real host, so it does not test the nested Docker, the restart policy there, or the network | It would repeat what CI already shows |
| Keep testing by hand on the live instance | Zero build cost | Risks real study data, not repeatable, not reviewable | The failure it risks is the one this project must prevent |
| Add the homelab to CI as a self-hosted runner | Fully automatic | Gives a public repository's workflows reach into a private network | Unacceptable exposure |

## Consequences

### Positive
- Real-host risks (R-2, R-7, R-8) become a command with a recorded result.
- Defects like B-1 are found before a release, not by the first user.
- The same script helps any self-hoster with a Docker host over SSH.

### Negative
- More code to maintain, and a test path CI does not run. It can rot if it is not run before each release.
- Needs SSH key access and a free port on the host.

### Risks
- A harness bug could touch the live instance. Mitigated by the marker file, the port and volume refusals, the dry run, and tests for each rule (including a negative control that points the harness at the live project and must refuse).
- A test project left behind after a dropped connection. Mitigated by teardown at the start of the next run.
- A disk-full test filling a real disk. Mitigated by using a size-limited tmpfs volume, not the host disk.

## Dependencies
- ADR-004 (container and base image), ADR-008 (backups and migrations: the documented backup commands are the ones under test).
- Constrains later releases: a release is not tagged without a harness run recorded in the QA report.
