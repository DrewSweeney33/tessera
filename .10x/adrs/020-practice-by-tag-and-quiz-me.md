# ADR-020: Practice by tag, and Quiz me for Practice only

**Status:** Accepted by the owner on 2026-10-18 (design conversation for Milestone 6: "Practice only, for any basic card", then "Approved").
**Date:** 2026-10-18
**Feature:** tessera-v1 (Milestone 6)
**Author:** Claude (Architect + Staff Engineer)
**Spec:** `.10x/specs/2026-10-18-milestone-6-study-quality-design.md`

## Context

Two items were left open by ADR-017:
- "Tag scope can follow later": Practice again takes one deck or one folder. The Statistics and Leeches pages already rank tags by how well they are recalled, but there is no way to practice a weak tag.
- "Auto-generated choice distractors" was deferred to v1.1. A choice card needs 2 to 8 written options. The owner wants wrong options made automatically.

Facts that shape the decisions:
- A multiple-choice answer is **recognition**; flipping or typing is **recall**. FSRS models recall. Grading a recognition task into the schedule would make intervals too long. Practice never touches the schedule (ADR-017), so Practice is the safe place for recognition.
- Card tags are a JSON array on `cards.tags`. The weak-tag queries already read them.
- Practice already builds each card on the server and only displays it in the browser (ADR-017), so a quiz question can be built server-side with no browser logic beyond display.
- The Leeches page lists wrong typed answers from log rows with grade 1, and practice rows with a typed answer would appear there.

## Decision

1. **A tag is a third practice scope** next to a deck and a folder: `/practice?tag=<tag>`, and `{ "tag": "..." }` on `POST /api/practice/start`, with exactly one of `deckId`, `folderId`, `tag`. The pool is every active card carrying that tag, in any deck that is not in the Trash, matched exactly as stored with `json_each(cards.tags)`. Entry points are a Practice link on each tag row of Statistics and Leeches.
2. **Quiz me is a Practice-only option** (`quiz: true` on start; one checkbox on the setup screen). It never applies to study and never changes the deck format.
3. **The server builds the quiz question** in a pure module (`core/quiz.ts`) and returns it as a choice-shaped item. A card is quizzable when its answer is one line of at most 160 characters and at least three usable wrong answers exist. Wrong answers are other cards' answers (same deck first), with empty, multi-line, long, and duplicate or near-duplicate answers removed, picked and ordered with a seeded shuffle (the session seed and the card id) so a reload and a resumed session show the same question.
4. **A correct pick is Got it, a wrong pick is Missed it** (and loops back). The picked option is **not** saved as a typed answer, so it never appears in the Leeches wrong-answers list.
5. **No migration, no new table, no deck format change.**

## Alternatives Considered

| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Quiz in study too, per card (`choices: auto`) | One authoring change makes a card a choice card | Changes the deck format and what a choice review means for the schedule (recognition graded as recall) | The owner chose Practice only |
| Generate wrong options in the browser | No server change | Logic split across both sides; harder to test; the server owns every other card build | Keep the server as the one place that decides what a card looks like |
| Ask Claude to write distractors into the deck | Better, more plausible wrong answers | Needs a deck format and skill change, and costs tokens per card; the owner wants it automatic | Possible later (Milestone 8) as a complement |
| Practice by tag using the deck-level tags | Simple | Statistics rank card tags, not deck tags, so the entry points would not match | Card tags match the weak-tag lists the person is looking at |
| Store the picked option as the typed answer | Keeps what was chosen | A wrong pick would show up as a "wrong typed answer" on the Leeches page | Misleading data; not saved |

## Consequences

### Positive
- The weakest tags on Statistics and Leeches become a one-tap practice session.
- The owner gets multiple-choice drilling for any basic or typed card with no authoring work, and the schedule stays honest.
- Everything is server-built and pure, so it is cheap to test thoroughly.

### Negative
- Auto-made wrong options are only as good as the other answers in the deck. A deck whose answers are alike gets odd questions, and a deck with fewer than four quizzable answers gets none.
- A wrong option can in rare cases also be correct (two cards with synonymous answers). The near-duplicate filter reduces it but cannot remove it.

### Risks
- The right answer missing from the options, or shown twice: covered by a planted-bug test and the builder's invariants.
- A tag with unusual characters or very many cards: the tag is length-limited and bound as a parameter; the count cap of Practice still applies.

## Dependencies
- ADR-017 (Practice again, the invariance test, practice rows), ADR-005 (strict inputs), ADR-009 (API guards).
- Constrains: a future quiz in study would need its own decision about how a recognition answer is graded.
