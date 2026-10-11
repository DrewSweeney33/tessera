# ADR-008: Forward-only migrations, upgrade backups, and write locking

**Status:** Accepted
**Date:** 2026-10-11
**Feature:** tessera-v1
**Author:** 10x-Team (DevOps + SRE)

## Context

Delivery testing ran real failures against the built server and found three operational gaps around upgrades and rollbacks.

1. Rolling back to an older image after an upgrade opened the newer database silently, because the migrator only checks for migrations that are missing, never for ones it does not know.
2. During an upgrade the old container may still be running when the new one starts, so two processes use one SQLite file. A transaction that reads first and writes later failed at once with "database is locked", ignoring `busy_timeout`. In a test, 47 of 60 concurrent imports failed.
3. A damaged database file produced "file is not a database", with no file name and no next step.

The learner's review history is the valuable data, and the operator is one person with no support team.

## Decision

1. **Migrations are forward-only.** There are no down migrations. Recovery from a bad upgrade is "restore the backup made before it", not "undo".
2. **A backup is written before every upgrade** that changes the schema, to `DATA_DIR/backups/pre-migrate-<timestamp>.db` (already in place). Nothing prunes the folder; the operations guide tells the operator to.
3. **Downgrade is refused.** If the database holds a migration newer than any this version knows, startup stops with a message that says to start the newer version again or restore the pre-upgrade backup. The database is not touched. `DatabaseTooNewError`.
4. **Write transactions are immediate.** `withTx` and the settings seed use `BEGIN IMMEDIATE`, so the write lock is taken up front, `busy_timeout` applies, and a second process waits its turn.
5. **A database that cannot be opened is explained.** Damaged, locked, unwritable, or full: the message names the file and the next step. `DatabaseOpenError`. The file is never modified.
6. **Items are stamped no earlier than their own last review**, so a clock that steps backwards cannot make a just-graded card unanswerable.
7. **Manual backups use SQLite's own snapshot** (`VACUUM INTO` from a read-only connection) and are safe while the app runs. Copying the live file is documented as unsafe.
8. **Image releases are tag-driven.** A pushed version tag runs the whole CI workflow, then builds and publishes. Nothing publishes otherwise. The tag must equal `package.json` `version` and the changelog must have a section for it.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Down migrations | Real rollback without a restore | Doubles the migration work, rarely tested, and cannot undo data written by new code | A tested backup restore is simpler and covers more cases. |
| Refuse to start a second process on the same data folder (lock file) | Prevents the overlap entirely | Needs lock file handling that survives crashes and Docker volume semantics. Also blocks harmless read tools. | Immediate transactions make overlap safe without new failure modes. |
| Single-process only, document "do not do that" | Nothing to build | The overlap happens in normal `docker compose up` upgrades | Documentation alone was already insufficient. |
| Continuous automatic backups inside the app | Better recovery point | New scheduler, retention, and storage policy; a feature, not a delivery fix | Planned for the export milestone (`GET /api/backup`). The documented command covers v0.1. |
| Release by pushing to `main` | Simpler | Every merge could publish | A deliberate tag is the safer gate for one maintainer. |

## Consequences

### Positive

- A rollback cannot silently corrupt data. The worst case is a clear refusal.
- Upgrades with overlapping containers work.
- The first thing an operator sees for a damaged file tells them what to do.

### Negative

- Rolling back after an upgrade loses anything studied since, unless the operator accepts the newer version. Documented in the operations guide.
- `BEGIN IMMEDIATE` holds the write lock slightly earlier for each write. With one user this is not measurable (grades still take about 10 ms).
- The pre-upgrade backups accumulate until the operator deletes them.

### Risks

| Risk | Mitigation |
|---|---|
| A future migration is not backward compatible with the guard's assumption that timestamps only increase | Migrations are generated in order by drizzle-kit. A test inserts a future migration and expects the refusal. |
| The release workflow has never run | Policy tests pin its safety rules, its shell steps were exercised locally, and a manual rehearsal mode exists. The first real run is a checklist item in `docs/releasing.md`. |

## Dependencies

- Builds on ADR-001 (SQLite, WAL, Drizzle), ADR-004 (container), ADR-007 (install scripts off).
- Constrains every future migration: it must be safe to run on the pre-upgrade backup and may not assume a down path.
