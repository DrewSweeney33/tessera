# QA report: Milestone L (library management), 2026-10-12

**By:** QA Engineer role. **Scope:** manual deck creation, export, editing, the Trash, Start over, the Backups page, and restore from the list (US-11 to US-16 except "Practice again", which is planned for a later milestone). **Design:** ADR-013 and ADR-014 (both accepted by the owner on 2026-10-12).

**Release readiness:** ready for a release candidate. The live-image harness has passed on the real host (CT123's Docker, test project only) against an image built from the committed code: 106 passed, 0 failed, 2 skipped (the probe's local-process check, and the soak, which was not requested). A final release still needs the harness run against the published release candidate (ADR-012), and the owner's choice of version number and tag.

## What was built and how it was tested

Every task was test first, and every service and handler was checked by planting bugs one at a time and confirming a test failed (mutation checks, run by hand with scratch scripts that restore the file afterwards).

| Task | Built | Tests added | Planted bugs |
|---|---|---|---|
| L-01 export | `exportDeck`, `GET /api/decks/:id/export` | 34 | 13, all caught or equivalent |
| L-02 create | `POST /api/decks`, New deck page, shared `slugifyTitle` | 22 + 26 + 11 browser | 13, all caught |
| L-03 snapshots | `createSnapshot`, `withSnapshot`, `listSnapshots` | 46 | 14, all caught |
| L-04, L-05 edit | pure editing logic, card editor, edit page, revision and `expected_revision` | 17 + 55 + 28 browser | 17 + 23, all caught |
| L-06 Trash | move, restore, list, delete for good | 40 + 13 browser | 15 + 12, all caught or equivalent |
| L-07 Start over | reset, `deck_resets` table (migration 0001) | 22 + 10 browser | 9 + 5, all caught |
| L-08 Backups | list, back up now, download, delete | 36 + 12 + 13 browser | 11, all caught |
| L-09 restore | inspect, stage, apply at start, API, panel | 35 + 18 + 13 browser | 11 + 7 + 3 + 11, all caught or equivalent |

Totals at the last full run: 1,736 unit and integration tests, 217 browser tests on each of Chromium and WebKit, an axe accessibility scan of every new state in both colour schemes, layout checks at 320, 375, and 768 pixels with every panel open, and about 490 security probe checks.

## Defects found by the testing, all fixed before this report

1. **A stale save could not be reloaded.** The "Keep editing" button on the stale-copy notice hid the only way to reload. Found by a browser test; the notice now stays until the deck is reloaded.
2. **Importing a deck into the Trash did nothing when the file matched.** The plan saw no change, although the guide (and a repository comment) said an import restores a deck. A test written for the guide's sentence failed. An import into a deck in the Trash is now a change, and the preview warns about it.
3. **Heading level skipped and duplicate landmarks** in the card preview (axe).
4. **Two probe expectations were too narrow** (a refusal can be 400, 403, or 415).
5. **The probe's oversized body** must carry its true length (chunked uploads over a small limit reset the connection: backlog B-3, unchanged).
6. **Building the image on the homelab host hung in `npm prune`** (R-14), for the full 15 minute timeout, three times. Turning off the audit and fund requests did not help. A clean production-only install in its own Dockerfile stage replaces it, and the same build now takes seconds on that host. The cause inside `npm prune` was not found.
7. **The harness's first restore check was too strict.** Docker restarted the server faster than the harness polled, so it never saw the server down. It now uses Docker's restart count.

## Verified behaviours worth naming

- Editing a card keeps what was studied on it (browser test: study one card, edit another's text, the new count is unchanged).
- A save from an out-of-date copy is refused with 409, and studying in another tab does not make a copy out of date.
- Removing a card archives it and can be undone until saving; a deck with no cards cannot be saved.
- Deleting a deck for good removes that deck's cards, schedule, reviews, import history, and reset records and nothing of any other deck; the id is free afterwards.
- Start over leaves every review in the log, makes every item identical to a never-studied item, and records the reset.
- A database made by the first release is upgraded by the real migration, with the backup taken first (an integration test).
- Restore: the crash tests stop the apply after each of its four steps; the next start finishes the restore and the end state is identical each time.

## What has not been tested

- **The published release candidate.** The harness ran on the real host against an image built there from the committed code. It covered the library features on the real image, the restore from the list (the server stopped itself, Docker restarted it once, and the data was the backup's with the old data kept beside it), and the upgrade from 0.1.1 with a rollback: the new image came up on 0.1.1's data and kept the deck and its progress, took the backup before the migration, 0.1.1 then refused the upgraded database saying it was newer, and putting the backup back brought 0.1.1 up again with the deck as it was. The ADR-012 rule is that the *published* candidate is what gets tested before a release, so that run is still owed.
- **A restore on a host without a restart policy.** The page and the guide say what to do; no browser test can stop the server.
- **Screen reader, phone, and a multi-day soak** (R-3, R-10, R-8) are unchanged and still open.
- **A very large deck in the editor** (thousands of cards). The editor shows fifty cards at a time and checks only open cards while typing, and a 120-card deck was tested in the browser. A 5,000-card deck was exercised by the unit tests of the editing logic but not in a browser.
- **Windows-only behaviour.** The server stops itself with SIGTERM, which Windows cannot deliver; the restore flow is for the container.

## Risks for the owner to know

- Restoring and deleting are one click and a typed word for anyone who can reach the page (security review S-11).
- Taking a backup repeatedly can fill the disk (S-12).
- This is the first release with a database migration (`0001_deck_resets`). Going back to 0.1.1 after upgrading needs the backup made before the upgrade, as the operations guide describes. The harness's `--expect-migration` run tests exactly that.
