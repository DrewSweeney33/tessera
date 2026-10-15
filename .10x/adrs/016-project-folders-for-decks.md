# ADR-016: Project folders that group decks and scope study

**Status:** Accepted by the owner on 2026-10-15 ("a projects folder that can be created on the decks screen to help organize the decks screen and studying. The folder should also have stats from the studying done within it.")
**Date:** 2026-10-15
**Feature:** tessera-v1 (library, after Milestone 3)
**Author:** Claude (Staff Engineer)

## Context

A full course is many decks. The owner imported a 31-deck CCNA course, titled `CCNA 01` to `CCNA 31` so they sort in study order, and the decks screen became one long list. The new-card queue is ordered by deck title, so the order of study is already set by titles; what is missing is a way to group decks, study one group, and see how studying that group is going.

Constraints:

- A deck file has `additionalProperties: false` (ADR-002), and a revised deck is imported over the old one by id. Grouping must not change what Claude writes, what export produces, or what an import does.
- The 31 CCNA decks and their 1,100 cards on the live instance must survive the migration (ADR-008, forward-only, backup first).
- The queue, the counts, and the leech and weak-tag queries already share one set of filters (ADR-003, ADR-015). A folder must use them, not copy them.

## Decision

1. **One folder per deck at most, and folders do not nest.** `decks.folder_id` is a nullable foreign key to a new `folders` table (`id`, `name`, `created_at`, `updated_at`), `ON DELETE SET NULL`. A column, not a join table, because a deck is in at most one folder and every scope query already joins `decks`. Names are unique ignoring case (a unique index on `lower(name)`), 1 to 60 characters, no control characters. The rule is one function in `core/folder.ts`, used by the form and the server.
2. **A folder is a label.** Creating, renaming, deleting, or filling a folder never touches a card, a schedule, or a review. Deleting a folder ungroups its decks (the foreign key does it) and needs neither a typed title nor a snapshot, because nothing is lost. The deck's `updated_at` and the editor revision ignore the folder. Import and export never read or write it: a deck imported for the first time is ungrouped, a re-imported deck keeps its folder, a deck in the Trash keeps its folder, and the deck JSON and Markdown formats are unchanged.
3. **Study scope.** `QueueScope` gains `folderId`. `eligible()` and `listDecksInScope()` add `decks.folder_id = ?`, so the queue order, the daily limits (per deck, with its own override), burying, and the counts are exactly those of any session, limited to the folder's decks. `GET /api/study/next?folderId=` and a `folderId` on `POST /api/study/review` (not together with `deckId`: 400). The page is `/study?folder=<id>`.
4. **Statistics** are read from the same tables, limited to the folder's decks that are not in the Trash, `mode = 'review'` only: reviews and time today, over 7 days, and over 30 days; retention as the share of review-phase reviews (`pre_phase = 2`) graded Hard, Good, or Easy, the same measure as weak tags (ADR-015); the streak of study days (counting back from today, or from yesterday while today has no review yet); the last 14 study days; items by stage (new, learning, review, suspended); open leeches; weak tags. "Today" and days use the study day (the rollover hour, ADR-003 and `core/study-day.ts`), never midnight. The list of folders carries a light summary (counts, reviews today, 30-day retention); the full numbers are `GET /api/folders/:id/stats`, loaded when the panel is opened.
5. **API.** `GET` and `POST /api/folders`, `PUT` and `DELETE /api/folders/:id`, `GET /api/folders/:id/stats`, and `PUT /api/folder-assignments { deckIds, folderId | null }` (all or nothing; an unknown deck, a deck in the Trash, or an unknown folder changes nothing). Moving decks has its own path rather than `/api/decks/folder`, because a deck id can be `folder`. `GET /api/decks` also returns `folders` and each deck's `folderId`. Request bodies are strict and small.
6. **Backups.** Folders are in the database, so every snapshot carries them and a restore brings them back. A backup from before this migration still restores and is upgraded when opened (pre-migrate backup first). `restore/inspect.ts` needs no change because it requires only the older tables.
7. **The screen.** Decks are grouped by folder, with decks in no folder under "Ungrouped decks" so nothing is hidden. A folder shows its numbers, Study folder, Stats, Rename, and Delete. A folder with more than six decks starts collapsed, and a person's choice is remembered in the browser. Moving decks is a mode with a checkbox on each deck and a bar to choose the target, so 31 decks move in two clicks.

## Alternatives Considered

| Alternative                                     | Pros                                         | Cons                                                                       | Why Not                                                                     |
| ----------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A deck in several folders (a join table)        | Flexible, like tags                          | A deck would count twice in totals and a folder study could repeat decks   | The need is grouping a course; tags on cards already give the other cut     |
| Nested folders                                  | Fits a large library                         | Recursive queries, breadcrumbs, and moving subtrees for a one-person app   | One level does the job now; nesting can be added over `folder_id` later      |
| A `folder` field in the deck file               | Travels with the deck                        | Breaks `additionalProperties: false`, changes what Claude writes, and re-imports would reset it | Folders are the learner's organization, not content                         |
| A folder per tag or by title prefix             | No new table                                 | Implicit, surprising, and renaming a title would regroup decks             | The owner asked for folders that are created and filled on the screen       |
| Statistics for every folder in `GET /api/decks` | One request                                  | Review-log scans for every folder on every page load                       | The list carries a light summary and the full numbers load on demand        |

## Consequences

- One new table and one new column, applied by migration `0002_folders` (a plain `ALTER TABLE ... ADD COLUMN`, so no table is rebuilt). The first start after upgrading writes the usual `pre-migrate` backup.
- `QueueScope` and a few repository functions take an optional folder. Nothing else in scheduling changes.
- Streak and daily numbers read up to 400 days of review times for one folder when its statistics are opened. That is a few thousand rows for one learner and is cheap; a much larger log would want a per-day summary table.
