# DevOps Decisions: Index

## Active features

| Slug | Summary | Status |
|---|---|---|
| `tessera-v1` | CI/CD, container, release process, deployment and rollback for Tessera | Delivery package for the M1 slice done and tested locally. First CI run, the container build, and the first release are waiting on the GitHub remote. |

## Cross-cutting DevOps principles

- **Boring and operable by one person.** One container, one SQLite file, Docker Compose. No orchestrator, no external services, no cloud dependency.
- **Rollback is a restore, not an undo.** Migrations are forward-only. A backup is made before every schema change. See ADR-008.
- **Nothing publishes by accident.** Releases start only from a pushed version tag, after the whole CI workflow passes on that commit. Pull requests cannot reach the release workflow.
- **Every action is pinned to a commit SHA**, verified against the upstream tag, and kept current by Dependabot. A test enforces this.
- **Run the failure before documenting it.** Every message and procedure in the operations guide was produced by running the real server, and a script re-checks them in CI.
- **Say what was not run.** The container build, the CI workflows, arm64, and the release workflow have never executed. They are listed as unverified everywhere they matter.
