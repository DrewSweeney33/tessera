# ADR-017: Practice again, statistics for any scope, and exam dates on folders

**Status:** Accepted by the owner on 2026-10-17 (design conversation for Milestone 4, "Approved"). Built 2026-10-17: slice A (Practice again) and slice B (statistics and folder exam dates).
**Date:** 2026-10-17
**Feature:** tessera-v1 (Milestone 4)
**Author:** Claude (Architect + Staff Engineer)
**Spec:** `.10x/specs/2026-10-17-milestone-4-practice-and-stats-design.md`

## Context

ADR-003 reserved a cram mode: grades never change FSRS state, rows are written with `review_log.mode = 'cram'`, and a lint rule keeps the practice code away from the scheduler's `review`. The column, the read-only scheduler half (`core/scheduler/read.ts`), and every `mode = 'review'` filter in the read side already exist. Folder statistics (ADR-016) already compute reviews, retention, streak, and daily totals for a folder. The owner has a 31-deck CCNA course in the live instance and wants to go through all of it before the exam, and to see how studying is going overall.

Constraints:

- A practice session must not change a schedule, a bury, a leech flag, or any number the study side shows (ADR-003, ADR-015).
- The deck formats do not change (ADR-002).
- Migrations are forward-only, with a backup first (ADR-008). The live database holds real history.
- `review_log.pre_*` columns are NOT NULL, so a practice row still records the item's state at the time.

## Decision

1. **Practice again is a client-held session over a server-chosen list.** `POST /api/practice/start` picks the pool (every item `eligible()` accepts for one deck or one folder, ignoring due dates and burying), orders it (shuffled with the injected rng, or weakest first by retrievability then lapses, with never-studied items last), cuts it to the chosen count, and returns item references only. The browser keeps the list and the loop-back state (`core/practice.ts`, pure) in `sessionStorage`. A missed item is reinserted four places later (or at the end); the session ends when every item has been answered right once. This is a deliberate exception to "the server is authoritative for the queue" (ADR-003 section 2): that rule exists so learning steps and burying stay correct, and practice has neither.
2. **Grading writes one log row and nothing else.** `POST /api/practice/grade` inserts a `review_log` row with `mode = 'cram'`, grade 3 (right) or 1 (missed), the pre-state copied from `card_state`, and null `result` and `scheduled_days`. It never updates `card_state`, buries, or flags leeches. The review id makes it idempotent; the same id on a different item is `review_id_reused`. The practice code lives in `src/lib/server/practice/` and `src/lib/core/practice.ts`, and an ESLint restricted-import rule forbids importing `scheduler.review`, the card-state writers, and the bury and leech writers there. A test compares `card_state` byte for byte before and after a session, with a planted bug that must fail it.
3. **Scope.** One deck or one folder (exactly one of `deckId` and `folderId`). No tag scope and no "weakest only" scope now; weakest first is an order. Count choices are 20, 50, 100, or all.
4. **Statistics take a scope.** `GET /api/stats?folderId=&deckId=` (neither means all decks; both is 400) returns one `StatsDto`. The folder statistics code becomes the scope-based code, and `GET /api/folders/:id/stats` calls it, so the folder panel is unchanged. New numbers: a 26-week heatmap, a 30-day due forecast from `card_state.due` with an overdue count, per-tag retention (90 days, at least 5 review-phase reviews), and a "practiced today" line from `mode = 'cram'` rows that is never added to anything else. Retention keeps the ADR-015 definition. Days are study days (the rollover hour), never midnight. The page is `/stats` with a scope picker, charts are hand-rolled SVG with text alternatives.
5. **Exam date belongs to a folder.** Migration `0003_folder_exam_date` adds `folders.exam_date text` (nullable, a plain add-column, no table rebuild). `PUT /api/folders/:id` takes an optional `examDate`. `FolderDto` carries `examDate` and `daysToExam`. From 14 days before the exam to the day after, the folder suggests Practice folder. The unused `decks.exam_date` column is left in place: dropping a column from a database with real history gains nothing and adds a risk.
6. **Backups.** Everything lives in the database, so snapshots carry it. A backup from before `0003` restores and is upgraded on open (pre-migrate backup first), and `restore/inspect.ts` needs no change.
7. **Delivery in two slices.** Slice A (practice, no migration) then slice B (statistics, exam dates, migration `0003`), each deployed to CT123 after a backup. Per the migration rule, slice B runs the live harness with `--expect-migration` before it is released.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| A server-held practice session (queue in memory or a table) | One place for the loop-back rules, like study | Lost on a server restart (restore restarts it), or a new table for state that is thrown away | Practice has no schedule to protect; the list is cheap to keep in the browser |
| Missed cards come back only in a second pass | Simplest | The owner chose looping back until right | Rejected by the owner |
| Practice that writes a normal review at a reduced weight | Extra data for the scheduler | Cramming inflates intervals and corrupts the estimates (ADR-003) | The requirement is that the schedule is not disturbed |
| Tag scope and weakest-only scope now (the US-7 wording) | Matches the first story | More UI for scopes the owner did not choose | Deck and folder scope is what the course needs; tags can follow |
| Exam date on each deck (the existing column) | No migration | Setting it on 31 decks, and the exam is for the course | The owner chose folders |
| Drop `decks.exam_date` | Tidier schema | Table rebuild or `DROP COLUMN` on live data for no user benefit | Left unused and documented |
| A chart library | Faster to write, more chart types | A dependency (ADR-007 rules), CSP and bundle cost, theming | Three simple charts are cheap to hand-roll |
| A per-day summary table for statistics | Constant-time stats | A second source of truth to keep in step with `review_log` | Read from `review_log`; revisit only if the benchmark says so |

## Consequences

### Positive

- The long-term schedule is protected by construction and by test.
- Statistics work for everything with one code path, and the folder panel shares it.
- No migration in slice A, so the first deploy is code only.

### Negative

- The practice queue rules live in the browser, in a pure module with its own tests. A second tab of the same scope shares `sessionStorage` per tab, not across tabs, so two tabs are two sessions.
- Practice reviews are log rows that no study number counts. The stats page must keep saying so ("practiced today" is separate), or the numbers will look inconsistent.
- `decks.exam_date` stays unused.

### Risks

| Risk | Mitigation |
|---|---|
| Practice code reaches the scheduler or card state | Restricted-import rule, byte-for-byte test, planted bugs |
| Study numbers include practice rows | Every read filters `mode`; a test inserts practice rows and compares all numbers |
| Forecast and heatmap are slow on a large log | 100,000-row benchmark; add an index only where `EXPLAIN QUERY PLAN` shows a scan |
| `sessionStorage` blocked or full | The session still works in memory; resume is lost and the setup says so |
| The migration fails on the live database | Plain add-column, `pre-migrate` backup, harness upgrade test with `--expect-migration` |

## Dependencies

- Builds on ADR-003 (cram isolation, queue filters), ADR-015 (retention measure, weak tags), ADR-016 (folders, scope, statistics).
- Constrains a future per-day summary table and any later tag scope for practice.
