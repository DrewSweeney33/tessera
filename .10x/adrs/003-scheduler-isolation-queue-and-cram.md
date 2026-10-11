# ADR-003: Scheduler Isolation, Study Queue, and Cram Mode

**Status:** Accepted
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + Staff Engineer)

## Context

Spaced repetition quality is the core of the study experience. FSRS is implemented by `ts-fsrs`. Tessera also needs in-session relearning (cards missed within minutes come back), daily limits, burying, leech flagging, and a cram mode that must never disturb the long-term schedule. The pieces must be testable without a database or a real clock.

Verified by running `ts-fsrs` 5.4.2 on 2026-10-10:

- Default `learning_steps` are `["1m","10m"]` and `relearning_steps` are `["10m"]`. Weights array has 21 entries (FSRS-6).
- A new card graded Good becomes `Learning` due in 10 minutes. A second Good moves it to `Review` due in 2 days.
- A card has `due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, state, last_review`.
- `repeat(card, now)` returns results keyed 1 to 4. `get_retrievability` exists.
- `ts-fsrs` 6.0.0 is on the `beta` tag only.

## Decision

### 1. Scheduler wrapper (`src/lib/core/scheduler/`)

Our own types, mapped to and from `ts-fsrs`. No other module imports `ts-fsrs`. All functions are pure and receive `now` as an argument.

```ts
type Grade = 1 | 2 | 3 | 4;            // Again, Hard, Good, Easy
type CardPhase = 0 | 1 | 2 | 3;        // New, Learning, Review, Relearning

interface ItemState {
  due: Date; stability: number; difficulty: number;
  elapsedDays: number; scheduledDays: number; learningSteps: number;
  reps: number; lapses: number; phase: CardPhase; lastReview: Date | null;
}

interface SchedulerConfig {
  targetRetention: number;             // default 0.90, per-deck override
  learningSteps: string[];             // default ["1m","10m"]
  relearningSteps: string[];           // default ["10m"]
  maximumIntervalDays: number;         // default 36500
  enableFuzz: boolean;                 // default true
}

interface Scheduler {
  initialState(now: Date): ItemState;
  preview(s: ItemState, now: Date): Record<Grade, { next: ItemState; label: string }>;
  review(s: ItemState, g: Grade, now: Date): { next: ItemState; snapshot: ReviewSnapshot };
  retrievability(s: ItemState, now: Date): number;
}
```

`ts-fsrs` is pinned to the 5.x line (exact version). The 6.0 beta is not adopted in v1. Default FSRS weights are used. The `review_log` stores enough to run the optimizer later, but no optimizer ships in v1.

### 2. Study queue is server-authoritative, one item at a time

The client asks `nextItem(scope, now)`. The server returns the next item and the four grade previews. The client may prefetch the following item but the server decides ordering after every grade. This keeps in-session relearning correct without duplicating queue logic in the browser. Latency is negligible (local SQLite).

Selection order for scope = a deck or all decks:

1. **Learning and relearning** items with `due <= now + 20 minutes` (learn-ahead), earliest first.
2. **Review** items with `due <= end of the current study day`, ordered by lowest retrievability first, limited by `reviews_per_day` minus reviews already done today.
3. **New** items ordered by `position`, limited by `new_per_day` (deck override or global) minus new items introduced today.
4. If nothing qualifies but a learning item is due later today, report the wait time. The session summary appears when all categories are empty.

Excluded from every category: `suspended`, `archived`, and items with `buried_until > now`.

- **Study day** is defined by the `rollover_hour` setting (default 4) in the `TZ` zone. Counts for "today" come from `review_log` rows with `mode = 'review'`.
- **Interleave** setting: when on, the review and new categories are drawn in random order across decks and tags instead of grouped.
- **Burying:** after any item of a cloze card is reviewed, its sibling items get `buried_until = next rollover`.
- **Leeches:** after a review, if `lapses >= leech_threshold` (default 8) and the item is not flagged, set `leech = 1`. The flag stays until the user resets it. Leeches are not suspended automatically.

### 3. Review submission

`submitReview({ reviewId, cardPk, ordinal, grade, servedAt, durationMs, typedAnswer? })`:

1. If `review_log.id = reviewId` exists, return the stored result (idempotent double submit).
2. In one transaction: load state, reject with `409 stale` if `last_review > servedAt` (another tab already graded this item), compute `review`, update `card_state`, insert `review_log` with the full pre-review snapshot, apply burying and leech rules.
3. Return the updated state and the next item.

### 4. Cram mode (`src/lib/core/cram.ts` and `src/lib/server/study/cram.ts`)

- Pure selection function: given items, scope (`all | tag | weakest`) and optional exam date, return a shuffled or weakness-ordered list. Weakest first sorts by lowest retrievability, then by lapses.
- Grading in cram writes `review_log` with `mode = 'cram'` and **never calls `scheduler.review` and never updates `card_state`**. The cram module has no import path to the scheduler's `review`, enforced by an ESLint restricted-import rule.
- Cram log rows are excluded from retention stats and daily counters. They appear in a separate cram history.
- A test asserts `card_state` is byte-identical before and after a simulated cram session.

### 5. Time

Every function that reads time takes a `Clock` or a `now: Date` argument. Only the HTTP layer constructs real dates. All stored timestamps are UTC ISO 8601.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Call `ts-fsrs` directly from routes and repos | Less code | Library types leak everywhere, version upgrade touches the whole app, harder to test, cram isolation is a convention instead of a boundary | Isolation is cheap now and expensive later. |
| Implement FSRS ourselves | No dependency | Algorithm is intricate, FSRS-6 has 21 parameters, risk of subtle bugs | `ts-fsrs` is the reference implementation (MIT). |
| SM-2 | Simple | Lower retention efficiency, no modern parameter model | User chose FSRS. |
| Adopt `ts-fsrs` 6.0 beta | Newest features | Beta on a non-`latest` tag | Stability matters more. Revisit after it is released. |
| Client-side queue with periodic sync | Fewer requests | Duplicates queue rules in the browser, hard to keep correct with learning steps and burying | Server authority is simpler and correct. |
| Cram that reschedules like normal reviews | Simpler code | Cramming inflates intervals and corrupts long-term memory estimates | The user's stated requirement is that cram does not disturb the schedule. |
| Auto-suspend leeches (Anki default) | Removes pain quickly | Hides weak cards. Conflicts with the Claude rewrite loop. | Flag and surface instead, user chooses. |

## Consequences

### Positive

- The scheduler, queue ordering, matcher, and cram selection are pure and unit-testable with a fake clock.
- Upgrading `ts-fsrs` changes one directory. Conformance fixtures show any behavior change.
- Cram cannot corrupt FSRS state by construction.

### Negative

- Server-authoritative queue means each grade is a request. Fine for local use, but a slow reverse proxy adds felt latency. Prefetch hides most of it.
- Our own state types need mapping code and tests.

### Risks

| Risk | Mitigation |
|---|---|
| Fuzz makes test outputs nondeterministic | Fuzz is disabled in tests via config, and a seeded variant is covered by a distribution test. |
| `ts-fsrs` changes semantics in a patch release | Exact pin, conformance fixtures generated from the reference library, update only with a fixture diff review. |
| Clock skew or DST bugs in study-day boundaries | Study day computed with `Intl.DateTimeFormat` in the configured TZ, tested across DST transitions. |
| Two tabs grading the same item | `servedAt` stale check returns 409 and the client refetches the queue. |

## Dependencies

- Depends on ADR-001 (repositories, transactions) and ADR-002 (`(card_pk, ordinal)` item identity, `position`).
- Constrains the stats unit (reads `review_log` by `mode`) and the weak-spot report (needs lapses, wrong typed answers).
