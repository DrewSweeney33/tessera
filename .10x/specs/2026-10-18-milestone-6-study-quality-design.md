# Milestone 6 design: study quality (undo, card order, practice by tag, Quiz me)

**Date:** 2026-10-18. **Status:** approved by the owner on 2026-10-18, waiting for the owner's go to build. **ADRs:** ADR-019 (undo the last answer), ADR-020 (practice by tag and Quiz me). **Estimate:** about 20 hours in three slices, each deployed to CT123 after a backup. No migration in any slice.

## Why this, and why now

The owner listed four directions after 0.2.1: study quality, safe on the network, the Claude authoring loop, and a close-out toward 1.0. They are four milestones, run in this order (the owner confirmed it):

| Milestone | Theme | About |
|---|---|---|
| **6** | **Study quality: undo, card order, practice by tag, Quiz me** | 20 h |
| 7 | Safe on the network: optional page password, backup limit, the oversized-body fix (B-3), closing S-11, S-12, S-14, S-15, S-16 | 24 h |
| 8 | The Claude authoring loop: a richer weak-spot report, a better Claude skill, cards that remember where they came from. Designed with the owner when it starts | 16 h |
| 9 | Close out toward 1.0: phone-pass and soak fixes, final docs and risk review, cut 1.0.0 | 8 h |

Milestone 6 goes first because the owner feels it every day. Everything in it came from the backlog or the deferred list: undo last grade and auto-made wrong answers were deferred to v1.1 (ADR-011 era), card reorder is B-4, and practice by tag was left as "tag scope can follow later" in ADR-017.

## Decisions made with the owner (2026-10-18)

1. **Undo reaches one step: the last answer.** Not several steps, not a history list.
2. **Auto-made wrong answers are for Practice only.** A "Quiz me" option in Practice again shows basic and typed cards as multiple choice. Study keeps recall (flip or type), because choosing from a list is easier than remembering and would distort the schedule. No change to the deck format.
3. **The milestone order above.**
4. The design below, approved as presented.

## Slice A: Undo the last answer (M6-01 to M6-04, about 8 hours)

**What the person sees.** On the study screen, after an answer, an **Undo** control and the keys `U` and Cmd/Ctrl+Z. It brings the card you just answered back as the current card, with its schedule exactly as it was and the grade gone from your statistics. It is available only for your most recent answer in this screen (the client keeps one review id, so there is no second step). Practice again gets the same Undo for its last answer.

**Rules (server, one transaction).** `POST /api/study/undo` with `{ "reviewId": "..." }`. It succeeds only if:
- a `review_log` row with that id exists, its mode is `review`, and it is the **newest `review`-mode row overall** (not just for the card), so an answer cannot be undone out of order or from a stale tab; and
- the card item has not changed since: its stored state equals the row's `result` (nothing else touched it).
Otherwise it answers 404 (`not_found`) or 409 (`not_latest`, `changed_since`) with a plain message and changes nothing.

On success it:
1. restores the item's state from the row's `pre_*` columns (due, stability, difficulty, elapsed days, scheduled days, learning steps, reps, lapses, phase, last review), byte for byte;
2. **deletes the log row**, so reviews today, the streak, retention, the forecast, daily limits (a new card comes back into the day's allowance), and the FSRS history all recompute honestly. A mistaken grade is not training data;
3. clears the leech flag if this review set it (the flag is set when `lapses` crosses the threshold, so: `pre_lapses` is below the threshold and the flag is on);
4. clears the burying of cloze siblings that this review set (when their `buried_until` equals the value this review would have set; if the rollover hour was changed in between, they stay buried until the next study day, which is the safe failure).
It returns the item to show again (the same DTO as `GET /api/study/next` for that card) so the client puts it on screen.

**Practice undo.** `POST /api/practice/undo` with `{ "reviewId" }`: the row must be mode `cram` and the newest `cram` row overall; it deletes that one row and nothing else (practice never touches state). The browser also removes the answer from its session state (the loop-back queue, the counters).

**Known edge, accepted (ADR-019).** After an undo the id is free again, so a delayed duplicate of the original answer request could grade the card a second time. The client does not retry grades and sends Undo only after it has the answer's response, so this needs a request stuck in the network for the whole round trip. The visible effect is a second grade the person can undo again. A tombstone table would close it but needs a migration; it is not worth one.

## Slice B: Card order and practice by tag (M6-05 to M6-07, about 6 hours)

**Card order in the editor (backlog B-4).** Each card row gets **Move up** and **Move down** buttons, with names such as "Move card 3 up", that work from the keyboard. Focus stays on the button that moved, a polite live region says "Card 3 is now number 2", and the buttons at the ends are disabled. Card order is part of the deck revision already, so a save made from a stale copy is still refused. Saving uses the existing import path (`cards.position`); task M6-05 first proves that the import rewrites positions for cards whose content did not change, and if it does not, fixes that in the import code with a test (a risk named below).

**Practice by tag.** `/practice?tag=<tag>` and `POST /api/practice/start` with `{ "tag": "..." }`: exactly one of `deckId`, `folderId`, `tag`. The pool is every active card with that tag in any deck that is not in the Trash (card tags are a JSON array on `cards.tags`, matched with `json_each`, exactly as stored). Count and order choices are the same. Entry points: a **Practice** link on each row of "Recall by tag" on Statistics and of "Weakest tags" on Leeches. The scope name in the setup screen is the tag. Practice still never changes a schedule (the existing invariance test is extended to a tag scope).

## Slice C: Quiz me, in Practice only (M6-08, M6-09, about 6 hours)

**What the person sees.** On the Practice setup screen, a checkbox **Quiz me: show cards as multiple choice**. With it on, basic and typed cards that can be quizzed are shown like a choice card with four options (the right one and three wrong ones); everything else (cloze, choice, and cards that cannot be quizzed) is shown as usual. A correct pick counts as **Got it**, a wrong pick as **Missed it** (and loops back like any miss). It never changes a schedule; practice answers stay apart from study numbers.

**How the wrong options are made (`core/quiz.ts`, pure, tested).**
- A card can be quizzed when its answer is one line of at most 160 characters (basic: `back`; typed: `answer`, the first accepted answer) and there are at least three usable wrong answers.
- Candidates are the answers of the other active basic and typed cards in the same deck first, then the rest of the practice scope. A candidate is dropped if it is empty, has more than one line, is longer than 160 characters, or equals the right answer or another candidate after trimming, collapsing spaces, and ignoring case.
- Three are chosen with a seeded shuffle (the session seed and the card id), and the four options are put in a seeded order, so a reload shows the same question. The seed is part of the saved session, so a resumed session looks the same.
- The server builds the question (`GET /api/practice/item` answers with the options and the index of the right one, only when the session was started with `quiz: true`); the browser only displays it, like every other practice card. Nothing is stored: no deck format change, no new table.
- The pick is not saved as a typed answer. (The Leeches page lists wrong typed answers from log rows with grade 1, and a pick of a wrong option from someone else's card would read as a mistake in that list.)

## API summary

| Route | Change |
|---|---|
| `POST /api/study/undo` | New. `{ reviewId }`. See Slice A |
| `POST /api/practice/undo` | New. `{ reviewId }` |
| `POST /api/practice/start` | Accepts `tag` as a third scope, and `quiz: true` |
| `GET /api/practice/item` | Answers a quiz card (`kind: "choice"`, `options`, `correctIndex`) when the session has `quiz: true` |

All new routes sit behind the host check, the JSON content-type rule, the cross-site guard, and the API token like every other route (ADR-009), have strict Zod bodies, and get probe checks.

## Testing

- **Undo is the dangerous one.** Integration test: for every grade 1 to 4 and every starting phase (new, learning, review, relearning), answer then undo and compare the whole `card_state` row, the sibling rows, and the log byte for byte with a copy taken before. Separate cases: the leech threshold crossing, cloze siblings, a stale tab (not newest, changed since), a double undo (404), undo after a restore, and counts (reviews today, daily limit, streak) returning to their earlier values. A planted-bug pass (restore one column wrong, forget the leech flag, forget the siblings, delete the wrong row) must be caught.
- Practice undo: deletes exactly one `cram` row, changes nothing in `card_state` (the existing invariance test compares the whole database).
- Tag scope: pool by tag across decks, Trash excluded, archived cards excluded, a tag with no cards (the "nothing to practice" message), an invalid tag (422), exactly-one-scope rule.
- Quiz: unit tests for the pure builder (too few candidates, duplicates, long and multi-line answers, determinism for a seed, same-deck preference); an API test; a planted bug where the right answer is not among the options.
- Card order: the editor test reorders with the keyboard, saves, reloads, and checks the order and that card ids and histories are unchanged; a stale save is still refused.
- E2E in Chromium and WebKit for each slice, accessibility scans in both themes for the new states, phone layout checks (Undo within thumb reach, the quiz options at 320 px), and probe sections for the new routes.

## Security and privacy

Same surface class as grading: anyone who can reach the page can already grade a card, so they can undo one. No new accepted risk beyond that (it joins S-11 in spirit, and Milestone 7 closes that class). Bodies are small and strict. The quiz builder reads only the owner's own cards. Nothing is sent anywhere.

## Out of scope

Several-step undo and a history list. Undo of imports, edits, deletes, or Start over (they have their own safety nets: the import preview, the Trash, the backups). Tag filters inside study (only Practice gets a tag scope). Quiz in study. A drag-and-drop card order (buttons are enough and are keyboard friendly). Any change to the deck format.

## Risks

| Risk | Mitigation |
|---|---|
| Undo restores a schedule wrongly | Byte-for-byte invariance test over every grade and phase, planted bugs, newest-only and unchanged-since checks |
| The import does not rewrite positions of unchanged cards, so a reorder is lost | M6-05 starts with a test that proves it; fix in the import path if needed |
| A quiz card with a misleading wrong option (it is in fact also right) | Same-deck preference, duplicate and near-duplicate removal, and the owner can skip a bad question like any card; wording "pick the best answer" |
| The Practice setup screen gets crowded on a phone | One checkbox; checked at 320 px |

## Next

The team writes the state files and waits for the owner's go. Then slice A. After slice C: QA and security review, a release candidate decision (no migration, so the live-image harness without `--expect-migration` is enough), and 0.3.0 or 0.2.2 as the owner chooses.
