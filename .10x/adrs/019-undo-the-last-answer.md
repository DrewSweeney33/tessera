# ADR-019: Undo the last answer

**Status:** Accepted by the owner on 2026-10-18 (design conversation for Milestone 6, "One step: the last answer", then "Approved").
**Date:** 2026-10-18
**Feature:** tessera-v1 (Milestone 6)
**Author:** Claude (Architect + Staff Engineer)
**Spec:** `.10x/specs/2026-10-18-milestone-6-study-quality-design.md`

## Context

"Undo last grade" was deferred to v1.1 in the first design. A mis-tapped grade (Easy instead of Good, Again on a card you knew) is the most common study mistake on a phone, and today it cannot be fixed: the card is rescheduled, a lapse may be counted, and the wrong grade stays in the history and in the statistics.

Facts about the code that make undo cheap and decide its shape:
- Every `review_log` row already stores the state **before** the review in `pre_*` columns (due, stability, difficulty, elapsed days, scheduled days, learning steps, reps, lapses, phase, last review) and the state after it in `result`. Nothing new needs to be recorded.
- A review changes three things besides the item's state: the leech flag (set when `lapses` reaches the threshold), the `buried_until` of cloze siblings, and the log. Reviews today, the streak, retention, the forecast, and the daily limits are all computed from the log.
- Practice answers are `review_log` rows with `mode = 'cram'` and change nothing else (ADR-017).
- The browser holds one review id per answer; it does not retry grades (`ui/api.ts` has no retry).

## Decision

1. **One step.** Only the most recent answer can be undone. The study and practice screens keep the id of the last answer; there is no stack and no history list.
2. **A new route per mode, in one transaction.** `POST /api/study/undo` and `POST /api/practice/undo`, strict bodies `{ reviewId }`.
3. **Study undo is allowed only if both hold:** the row is the newest `mode = 'review'` row overall, and the item's stored state still equals the row's `result`. Otherwise 404 or 409 with a plain message and no change. This makes an out-of-order undo and an undo from a stale tab impossible.
4. **Study undo restores the state from the `pre_*` columns, deletes the log row, clears the leech flag if this review set it, and clears the sibling burying this review set.** The log row is **deleted**, not marked, so every statistic and the daily limits recompute without a change to a single query, and a mistaken grade is not kept as training data for the scheduler.
5. **Practice undo deletes one `cram` row** (the newest `cram` row overall) and changes nothing else.
6. **No migration.**
7. **The accepted edge:** after an undo the review id is free again, so a delayed duplicate of the original answer request could grade the card a second time.

## Alternatives Considered

| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Mark the row as undone (`undone_at` column) | The history keeps the mistake; closes the duplicate-request edge | A migration, and every statistic, limit, streak, forecast, leech count, and the FSRS history must learn to skip undone rows: many queries, each a place to be wrong | Large risk for a small gain. The owner does not want mistaken grades in the data anyway |
| A tombstone table of undone ids | Closes the duplicate-request edge and keeps queries unchanged | A migration for a risk that needs a request stuck in the network for a whole round trip | Not worth a migration; revisit if a retry is ever added to the client |
| Several steps back, or a list of recent answers | More forgiving | Out-of-order restores of one card, more rules and tests, easy to undo by accident in a long session | The owner chose one step |
| Undo by re-grading the card (answer again) | No new route | Adds a second log row (two lapses for one card), cannot restore the state, and does not remove the mistake from the data | Wrong result |
| Recompute state by replaying the card's history | Never trusts stored columns | The scheduler is not guaranteed to be replayable after setting changes, and it is slower | The `pre_*` columns are exact and already there |

## Consequences

### Positive
- A mis-tap costs one tap. The schedule, the statistics, and the daily limits go back exactly.
- No migration, so a rollback is a normal image rollback.
- The newest-only and unchanged-since checks keep a stale tab from rewriting a schedule.

### Negative
- A deleted row is gone for good. The only copy of a mistaken grade is in the backups.
- Cloze sibling burying can only be reversed exactly when the rollover hour has not changed since the answer; otherwise the siblings stay buried until the next study day (the safe failure).

### Risks
- **Restoring a schedule wrongly is the worst outcome.** Mitigation: a byte-for-byte test over every grade and every starting phase, the leech and sibling cases, planted bugs, and the two guards above.
- **The duplicate-request edge (decision 7).** Effect: the card is graded again and the person can undo again. Probability: needs a duplicate stuck for a full round trip, and the client does not retry.

## Dependencies
- ADR-003 (review log and state in one transaction), ADR-017 (practice rows), ADR-009 (API guards).
- Constrains: any future client retry of grades must add the tombstone first.
