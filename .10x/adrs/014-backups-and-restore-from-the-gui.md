# ADR-014: Backups and restore from the GUI

**Status:** Accepted by the owner on 2026-10-12, with the assumptions listed in the product requirements file ("Questions for the owner")
**Date:** 2026-10-12
**Feature:** tessera-v1 (library management: user stories US-15 and US-16, and the snapshots that ADR-013 relies on)
**Author:** 10x-Team (Architect + DevOps + Security)

## Context

Today a backup is a command in the operations guide (`VACUUM INTO` through `docker compose exec`), plus an automatic copy before a database upgrade. The owner wants backups from the GUI. M3-07 already planned a `/api/backup` download. ADR-013 adds a second need: a snapshot before every destructive action (permanent delete, start over, restore).

Facts that shape the design:
- The data folder has a `backups` folder (created at start since 0.1.1). The container's root filesystem is read-only, `/tmp` is memory-backed and counts against the 512 MB limit, and `/data` is the one writable disk path.
- `VACUUM INTO` takes a consistent snapshot while the app runs and takes under a second for a large deck. It fails with `SQLITE_FULL` on a full disk, which the API now reports as HTTP 507.
- The adapter's request body limit is 5 MB for every route. A database can be larger than that.
- Nothing prunes the `backups` folder (ADR-008).
- A running server holds its database open (with a write-ahead log). Swapping the file under it is unsafe.
- The host check, the JSON-only guard, and the token rule protect `/api/*`. The page is unauthenticated by design. A database download is therefore as exposed as the page itself, which already shows every card.
- A backup on the same disk does not protect against losing the disk. The harness proved the documented backup and restore steps on the real host.

## Decision

1. **A Backups page and four routes.** `POST /api/backups` takes a snapshot into `<dataDir>/backups/manual-<timestamp>.db` and returns its name, size, and time. `GET /api/backups` lists every snapshot there (kind: manual, before-upgrade, before-delete, before-reset, before-restore) with size and time. `GET /api/backups/:name` streams one as a download. `DELETE /api/backups/:name` removes one after a confirmation in the page.
2. **Names are never paths.** `:name` must match `^[A-Za-z0-9._-]{1,120}\.db$` and must be a file the listing would show. Anything else is a 404 with no information. No path component is ever taken from a request.
3. **Snapshots are written into the data folder, not `/tmp`**, and streamed from the file with `Cache-Control: no-store` and `Content-Disposition: attachment`. Memory use does not grow with database size. A full disk answers 507 and does not delete or truncate anything.
4. **Automatic snapshots** before permanent delete, start over, and restore are named by kind and subject (`pre-delete-<deck>-<time>.db`) and follow the same rules. They are never deleted automatically. The Backups page shows their total size and warns above a threshold, and the owner deletes old ones.
5. **Restore is staged, not hot-swapped, and works from the list.** The owner picks a snapshot already in the `backups` folder (to restore a file from elsewhere, copy it into that folder first, as the guide describes). The server checks it (integrity check, a Tessera database, a migration level this version understands, the card and review counts shown to the owner), takes a `pre-restore` snapshot of the current data, writes a small marker file, and shuts down cleanly. On the next start, before opening the database, the server sees the marker, moves the current files aside (`tessera.db.before-restore`), copies the snapshot into place, removes the old write-ahead files, and starts normally. The page tells the owner the server is restarting. **This needs a restart policy** (Compose's `unless-stopped` provides it); the guide says so, and without one the server stays stopped until it is started by hand.
6. **No upload of a database through the page in the first cut.** The 5 MB body limit applies, and a bigger limit on one route weakens the global guard. Download is in scope. Upload is a documented manual copy.
7. **The page says what a backup does not do:** a copy on the same disk does not protect against losing the disk, and the page suggests copying it elsewhere. Scheduling backups inside the app is out of scope. The guide keeps the cron recipe.
8. **Probe and tests:** each route is in the security probe (traversal attempts, odd names, wrong methods, token rules, 507 behaviour), restore has a crash test (a kill between the marker and the swap must leave either the old data or the new, never a mix), and the live-image harness exercises download, restore, and the restart on the real host.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Only a download link (M3-07 as first outlined) | Smallest | No list, no snapshots for ADR-013, nothing to restore from | Does not meet US-15 or ADR-013 |
| Write the snapshot to `/tmp` and stream it | No disk use after | `/tmp` is memory-backed and counts against 512 MB, so a 55 MB database costs real memory, and a big one can be killed | The data folder is the safe place |
| Restore by hot-swapping the database handle in the running server | No restart | Every repository holds the handle. A bug here corrupts or splits data. Hard to test. | Restart is simple and testable |
| Upload a database through the page | Familiar | Needs a larger body limit for one route. A hostile page cannot upload (JSON-only and host guards), but the surface is bigger. | Download and in-folder restore cover the need |
| Scheduled backups in the app | No cron | A background timer, retention rules, and failure handling | Not requested. Keep the cron recipe |

## Consequences

### Positive
- The owner can back up, see, and download from the page, and every destructive action has a snapshot.
- Restore is reversible (a `pre-restore` snapshot and `tessera.db.before-restore`).
- No new dependency, and the same mechanism the guide documents and the harness tests.

### Negative
- Restore restarts the server. Without a restart policy it stays down until started by hand.
- Snapshots accumulate. The page shows the total and the owner prunes.
- A full disk blocks destructive actions, by design.

### Risks
- A hostile or curious reader of the page can download the whole database. The page already shows the same content card by card, and the guide says the page has no login. Not a new class of risk, but it is stated in the security review at the milestone exit.
- Restore applied to the wrong snapshot loses recent study. The page shows the snapshot's date and counts and the current ones side by side, and the `pre-restore` snapshot undoes it.
- The marker file and the swap are the delicate step. A crash test covers it.
- A backup name collision. Names carry a timestamp to the second plus a counter.

## Dependencies
- Depends on: ADR-008 (forward-only migrations and the backup mechanism), the `backups` folder created at start (0.1.1), `toErrorResponse` (507 and 503), ADR-005, ADR-009, ADR-011.
- Constrains: ADR-013 (snapshots before destructive actions), the operations guide (a restart policy is required for GUI restore), and the harness (it gains download and restore steps).
