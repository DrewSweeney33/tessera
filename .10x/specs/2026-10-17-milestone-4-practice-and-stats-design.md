# Design: Milestone 4, Practice again and statistics

**Date:** 2026-10-17
**Feature slug:** `tessera-v1` (Milestone 4)
**Status:** Approved by the owner on 2026-10-17 in a design conversation. Nothing in this document has been implemented. ADR: `.10x/adrs/017-practice-again-statistics-and-exam-dates.md`.

## Why

The owner has a 31-deck CCNA course (1,100 cards) loaded in the live Tessera and an exam to prepare for. Normal study follows the FSRS schedule, which is right for the long term but cannot "go through everything again" in the days before an exam without wrecking the intervals. Practice again (US-7, and the "practice again" half of US-13) does that without touching the schedule. The owner also wants to see how studying is going across everything, not only inside one folder (US-8).

## What the design reuses

| Existing piece | Use in this milestone |
|---|---|
| `review_log.mode = 'cram'` (column and CHECK) | Practice reviews are stored with this mode. Leeches, weak tags, daily limits, retention, and folder statistics already read `mode = 'review'` only, so practice cannot skew them. |
| `core/scheduler/read.ts` | The only scheduler import practice code may use (`retrievability`, for the weakest-first order). |
| `core/folder-stats.ts`, `repos/folder-stats.ts`, `server/folders/stats.ts`, `FolderStats.svelte` | Generalized from a folder to a scope (all decks, one folder, one deck). The folder panel keeps working. |
| Study card rendering, typed and choice matchers (`core/typed-match.ts`, `core/choice.ts`, `ui/study-card.ts`) | Practice shows cards the same way and marks typed and choice answers the same way. |
| `QueueScope` and `eligible()` (`repos/study-queries.ts`) | The pool for a session is chosen with the same filters, so Trash, suspended, removed, and buried-for-clone rules are not copied. |

## Decisions the owner made

1. A missed card loops back inside the session until each card has been answered right once. Nothing is written to the schedule.
2. A session covers one deck or one whole folder. The tag scope and the weakest-only scope from US-7 are not built now. Weakest first remains as an order.
3. The pool is every active item in the scope, with a count the owner chooses (20, 50, 100, all). Default: all, shuffled.
4. Statistics get their own page, `/stats`, with a scope picker.
5. The exam date belongs to a folder, not a deck.

## 1. Practice again

### Entry points and setup

- Each deck tile gets "Practice again"; each folder gets "Practice folder" beside "Study folder". The page is `/practice?deck=<id>` or `/practice?folder=<id>`.
- Setup shows the pool size, a count choice (20, 50, 100, all; only the sizes smaller than the pool), and an order choice (Shuffled, Weakest first). It then starts the session.

### Pool and order (server)

- `POST /api/practice/start { deckId | folderId, count: number | 'all', order: 'shuffle' | 'weakest' }` returns `{ total, items: [{ cardPk, ordinal }] }`, already ordered and already cut to the count. Exactly one of `deckId` and `folderId` is required (400 otherwise).
- The pool is every item that `eligible()` accepts for the scope, except that "buried" and "due" do not matter: practice ignores burying and due dates. Suspended items, removed cards, and decks in the Trash are left out. An empty pool is a clear answer ("nothing to practice"), not an error page.
- Shuffled uses the injected rng (Fisher-Yates). Weakest first sorts studied items by lowest retrievability (`core/scheduler/read.ts`), then most lapses, then `(cardPk, ordinal)`; items never studied (phase New) come last. The count cuts after ordering.

### Session (browser)

- The browser keeps the ordered list and the loop-back state in `sessionStorage` (key per scope), so a reload resumes. A session that was left is resumed or discarded from the setup page.
- `core/practice.ts` (pure) holds the queue: `start(items)`, `current()`, `answer(right)`, `summary()`. A right answer removes the item from the queue. A missed item is reinserted four positions later (or at the end when fewer remain). The session ends when the queue is empty. The summary counts items right first time, items that took extra rounds, total answers, and time.
- Each item is fetched with `GET /api/practice/item?cardPk=&ordinal=`, which returns the same item shape as study without grade previews. The card is shown and answered as in study (flip cards, typed answers, choices, cloze).
- Buttons: flip cards show **Missed it** and **Got it**. Typed and choice cards are marked by the existing matchers; right answers show "Got it" as the continue action, wrong ones show the correct answer and the item loops back. Keyboard: the same keys as study for reveal and continue, `1` for Missed it and `3` for Got it.
- The summary offers "Practice the misses again" (a new session over the items that needed extra rounds), "Practice again" (setup), and "Back to decks".

### Grading (server)

- `POST /api/practice/grade { reviewId, cardPk, ordinal, right, durationMs, typedAnswer? }`. The body limit is 16 KB, like the study review.
- The server loads the item's current state, inserts one `review_log` row with `mode = 'cram'`, `grade` 3 when right and 1 when missed, the pre-state columns copied from `card_state` (they are NOT NULL), `result` and `scheduled_days` null, and the duration and typed answer. It then returns `{ ok: true }`.
- It never updates `card_state`, never buries a sibling, never changes a leech flag. The `reviewId` makes it idempotent: the same id with the same item returns ok without a second row; the same id with a different item is `review_id_reused` (409).
- An unknown item, a removed card, an item in a deck in the Trash, or a suspended item is `not_found` (404).

### Invariants and how they are enforced

| Invariant | Enforcement |
|---|---|
| Practice never changes `card_state` | `src/lib/server/practice/**` has no import path to `scheduler.review`, `updateCardState`, or the bury and leech writers (ESLint restricted-import rule, like the cram rule planned in ADR-003). A test dumps `card_state` before and after a simulated session of right and missed answers and compares it byte for byte. A planted bug (calling the review path) must fail it. |
| Practice rows never count as study | The read side already filters `mode = 'review'`. A test inserts practice rows and asserts that daily limits, queue counts, leeches, weak tags, retention, streak, and folder statistics are unchanged. |
| Idempotent grading | A test submits twice with one id. |

## 2. Statistics page

- Route `/stats`, a new entry in the tab bar and rail. A scope picker offers All decks, each folder, and each deck (not decks in the Trash). The choice is in the URL (`/stats?folder=<id>` or `?deck=<id>`) and remembered in `localStorage`.
- `GET /api/stats?folderId=&deckId=` (none: all decks; both: 400) returns `StatsDto`. `GET /api/folders/:id/stats` stays and returns the same numbers through the same code, so the folder panel is unchanged for the user.
- Numbers, all from `mode = 'review'` rows and the study day (rollover hour, never midnight):

| Number | Definition |
|---|---|
| Today, 7 days, 30 days | Reviews and time, as the folder panel |
| Retention | Review-phase reviews graded Hard, Good, or Easy over all review-phase reviews, for 7 and 30 days (the measure used by weak tags, ADR-015) |
| Streak | Study days in a row with at least one review, counting back from today or from yesterday while today has none |
| Heatmap | Reviews per study day for the last 26 weeks, shown as a grid of weeks |
| Forecast | Items due on each of the next 30 study days from `card_state.due` for review and relearning items; learning items due today are counted today; a separate overdue count for review items due before today |
| Items by stage | New, learning, review, suspended |
| Per-tag retention | For each tag, the same retention measure over 90 days, only tags with at least 5 review-phase reviews, lowest first, up to 10 |
| Practiced today | Distinct items and time from `mode = 'cram'` rows since the day start, shown as its own line and never added to any other number |

- Charts are hand-rolled SVG (no chart library): a bar chart for the last 14 days, the forecast bars, and the heatmap grid. Each chart has a text alternative (a visually hidden table), uses the theme tokens, and reads in both themes and at 320 px.
- Index work: add an index only where `EXPLAIN QUERY PLAN` shows a scan on the 100,000-row benchmark; record the result in the benchmark docs (`docs/performance.md`).

## 3. Exam dates on folders

- Migration `0003_folder_exam_date`: `ALTER TABLE folders ADD exam_date text` (nullable, a plain add-column). The unused `decks.exam_date` column stays as it is; dropping a column from a live database buys nothing (ADR-017).
- `core/folder.ts` validates the date (`YYYY-MM-DD`, a real calendar date). `PUT /api/folders/:id` accepts an optional `examDate: string | null`; leaving it out keeps the value. `FolderDto` gains `examDate` and `daysToExam` (calendar days from the current study day, negative once past).
- The folder heading shows "Exam in 12 days" (or "Exam today", "Exam was 3 days ago"). From 14 days before the exam until the day after it, the folder also shows a suggestion to use "Practice folder". The edit form (rename) gets a date field and a clear button.
- Backups and restore: the column is in the database, so snapshots carry it. A backup from before the migration still restores and is upgraded when opened (the usual pre-migrate backup first).

## Out of scope

Tag scope for practice, undo last grade, exam dates on single decks, a chart library, per-deck forecast limits, sync between devices for an unfinished practice session, and any change to the deck JSON or Markdown formats.

## Delivery in two slices

Each slice ends with the full checks, a backup of CT123, and a deploy per `Tessera-Deploy-Runbook` (the owner's standing instruction). Nothing is committed or pushed until the owner asks.

| Slice | Contents | Migration |
|---|---|---|
| A: Practice again | M4-01 to M4-04 | None |
| B: Statistics and exam dates | M4-05 to M4-08 | `0003_folder_exam_date` |

## Tasks

| ID | Task | Size |
|---|---|---|
| M4-01 | `core/practice.ts`: queue with loop-back, summary, pure; `server/practice/select.ts`: pool, shuffled and weakest-first order, count; unit and integration tests | M |
| M4-02 | `POST /api/practice/start`, `GET /api/practice/item`, `POST /api/practice/grade`; the invariance test, the lint rule, the planted-bug checks, probe entries | M |
| M4-03 | `/practice` page: setup, session, summary, resume; entry points on deck tiles and folders; keyboard keys | M |
| M4-04 | Slice A e2e (Chromium, WebKit), accessibility scan, docs, vault notes, deploy | S |
| M4-05 | Generalize folder statistics to a scope; `GET /api/stats`; forecast, heatmap, per-tag retention, practiced today; tests | M |
| M4-06 | `/stats` page with the scope picker and SVG charts; nav entry | M |
| M4-07 | Migration `0003`, exam date on folders (validation, API, countdown, suggestion, restore test) | S |
| M4-08 | 100,000-row benchmark and indexes, slice B e2e, accessibility, docs, vault notes, deploy | S |

Estimate: about 16 hours of work in the plan's units, down from 22 because the folder statistics already exist.

## Risks

| Risk | Mitigation |
|---|---|
| A bug in practice grading changes the schedule | Lint rule, byte-for-byte `card_state` test, planted bugs; practice code lives in its own folder |
| Practice rows leak into study numbers | A test inserts practice rows and compares every study number before and after |
| A 1,100-item session list is large in `sessionStorage` | The list is references only (about 20 bytes each) |
| Weakest-first with unstudied items looks odd | Unstudied items go last and the setup text says so |
| Forecast queries are slow at 100,000 reviews | The benchmark and `EXPLAIN QUERY PLAN` decide the indexes before the slice ships |
| The stats page grows large | One scope at a time, one request, the folder panel shares the code |
