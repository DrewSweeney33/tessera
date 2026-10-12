# Security review: Milestone L (library management), 2026-10-12

**By:** Security Engineer role. **Scope:** everything added since 0.1.1: export, create a deck, edit (load with a revision, save with `expected_revision`), the Trash (trash, restore, delete for good), Start over, the Backups routes (list, back up now, download, delete), and restore from the list. **Against:** ADR-005 (security posture without login), ADR-009, ADR-011, ADR-013, ADR-014.

**Result:** no blocking findings. Two accepted risks are named below (S-11, S-12) for the owner. Findings S-04 and S-10 from the M2 exit are unchanged.

## The new surface

| Route | Method | What it can do | Guards |
|---|---|---|---|
| `/api/decks` | POST | make an empty deck | host check, JSON only, token for non-page callers, 16 KB body |
| `/api/decks/:id` | GET | read a deck as a document and its revision | same |
| `/api/decks/:id/export` | GET | read a deck as a file | same |
| `/api/import?expected_revision=` | POST | change a deck (existing route, one new parameter) | same, 5 MB body, 64 hex characters or 400 |
| `/api/trash`, `/api/decks/:id/trash`, `/restore` | GET, POST | hide or show a deck | same |
| `/api/decks/:id/delete-forever` | POST | delete a deck and its history | same, typed title, snapshot first |
| `/api/decks/:id/start-over` | POST | reset a deck's schedule | same, typed title, snapshot first |
| `/api/backups` | GET, POST | list backups, take one | same |
| `/api/backups/:name` | GET, DELETE | download or delete one | same, name must be a listed file |
| `/api/backups/:name/preview`, `/restore` | GET, POST | read a backup's counts, stage a restore and stop the server | same, typed word, safety copy first |

## What was checked, and how

- **Every route is in the probe** (`scripts/security-probe.ts`, now about 490 checks): traversal and odd ids and names, wrong methods, a foreign `Host` (421), cross-site posts as `text/plain`, form types, and no content type, bodies that are not JSON, oversized bodies (413), extra fields (422), and the token rule on every route (401 without, a path variant with percent-encoding also 401, 200 with). The probe never completes a restore, because that would stop the server it is testing. It checks that no restore is staged and that the server is still up after its refusals.
- **A name is never a path.** A backup is served, previewed, deleted, or restored only if `listSnapshots` shows it: a plain file in the backups folder, with a name of letters, digits, dot, underscore, and hyphen, ending in `.db`, never `tessera.db`. Sixteen hostile names (dot segments, encoded slashes, a backslash, a NUL, a very long name, markup, the WAL file name, the live database) are tested in the integration suite and thirteen in the probe, for both GET and DELETE. Every one is the same 404 with no echo of the input and no path.
- **Cross-site.** A page on another site cannot send `application/json` without a preflight, and no CORS header is ever sent. The probe sends trash, delete, start over, backup, delete backup, and restore as `text/plain`, a form type, multipart, and with no content type, from a foreign `Origin`, and each is refused (400, 403, or 415) with nothing changed. (A `DELETE` that carries a body is answered 400 by the framework before it reaches the app. That is still a refusal.)
- **Destructive actions need a typed word** (the deck title, or `restore`), compared exactly after trimming, and the server checks it, not only the page. A wrong word is a 422 that names the field and does not repeat what was typed. Case, a prefix, the id instead of the title, and extra text are all refused.
- **Snapshot first, or nothing.** Permanent delete, Start over, and restore each take a snapshot before they change anything, and none runs if the snapshot cannot be written (tested with an injected full disk, which answers 507). Deleting a deck is one transaction.
- **Restore is staged, not hot-swapped.** The server never replaces a database it has open. At the next start, before opening it, the apply step re-checks the backup (a SQLite header, `integrity_check`, the required tables, and a migration level this version understands), then copies, renames, and removes the old write-ahead files in an order a crash cannot leave half done. A crash after each of the four steps was simulated, plus a half-written copy and a data folder with no database, and the end state was the same each time. A marker that has been tampered with (a name that climbs out of the folder, the live database as the backup, a path as the old-database name, text that is not JSON) is refused and moves nothing. A restore that cannot be done leaves the database as it was and the Backups page says so.
- **No secret and no title in the logs.** Handlers log a deck id, a backup name, and counts. A test checks that a title typed into a confirmation never reaches the log.
- **The stale-copy check cannot be bypassed by studying.** The revision fingerprints the deck's content and nothing else, so it cannot be used to make an editor fail on purpose by studying, and a stale save is refused with 409 inside the same transaction that would write.
- **Output encoding.** Card text in the editor preview goes through the same sanitizing Markdown renderer as the study screen. A deck title with markup, shown in the Trash page, the Start over panel, and the Backups page, is plain text (browser tests with an `<img onerror>` title for each).

## Findings

**S-11 (accepted risk, owner to confirm): anyone who can reach the page can do any of this.** The page has no login by design (ADR-005). That was true of studying and importing. It is now also true of deleting a deck for good, starting a deck over, deleting a backup, downloading the whole database, and restoring an older backup (which also stops the server). The typed word guards against a slip, not against a person. The safety copies mean most of these can be undone by the owner on the host, with one exception: **deleting a backup file, including a safety copy, cannot be undone.** The guidance in `docs/security.md` still stands: keep the page behind a VPN or a reverse proxy that asks for a password, and note that the API token does not protect the page's own calls. Mitigation if wanted later: an optional page password. Not built, not asked for.

**S-12 (accepted risk): repeated "Back up now" can fill the disk.** Each backup is a full copy (about the size of the database). A caller who can reach the page can take them until the disk is full. Nothing prunes the folder, as ADR-014 chose. A full disk answers 507 with a plain message, nothing is damaged, and the Backups page lists sizes so the owner can delete. No rate limit was added. A limit on the number of backups taken in an hour would be a small change if the owner wants one.

**Observation (no action): a restore stops the server, and a restart policy starts it.** A caller who can reach the page can therefore restart Tessera. With the restart policy in `compose.yaml` the outage is a few seconds. Without one, the server stays stopped until it is started by hand, and the Backups page and the operations guide say so.

**Observation (no action): restoring a backup runs no code from it.** Opening a SQLite file can run triggers on later writes, so a crafted database put in the backups folder by someone who already controls the data folder could change data. Controlling the data folder is already full control, so this adds no new capability. The restore refuses files that are not Tessera databases, but it does not scan their contents.

## Dependencies and the image

No new runtime dependency was added in this milestone. `npm audit` and the image scan are unchanged. The Dockerfile now passes `--no-audit --no-fund` to `npm ci` and `npm prune` (for a build that hung on the audit request). That affects the build only, not the scans that CI runs on the finished image.

## Not covered here

The live-image harness run against the release candidate on the real host (ADR-012) is a release step, not part of this review.
