# ADR-015: Leeches, weak tags, and the weak-spot report for Claude

**Status:** Accepted by the owner on 2026-10-12 ("Lets continue", after seeing the library work on CT123); the report wording is the owner's to adjust after trying it
**Date:** 2026-10-12
**Feature:** tessera-v1 (US-6, Milestone 3)
**Author:** 10x-Team (Architect + Staff Engineer + Security)

## Context

The reason Tessera exists is the Claude round trip: Claude writes a deck, the learner studies it, and the cards the learner keeps failing go back to Claude to be rewritten. Everything that round trip needs already exists except the part in the middle. An item is flagged `leech` when its lapses reach a threshold (built in M1-12, never suspended), the review log keeps every grade with the typed answer, and import already updates a card by id without touching its history. What is missing is a way to see the leeches, act on them, find the weak tags, and hand the whole thing to Claude as one paste.

Constraints:

- The report is read by a language model, so its shape matters more than its prettiness. It has to fit in a prompt, and what Claude returns has to import without edits.
- A card's id must come back unchanged, or its history is orphaned (ADR-002). A card's type must not change, or its history is erased (ADR-013).
- Importing a deck leaves cards it does not mention alone (that is the default, `archive_missing` is off). A deck document that holds only the revised cards therefore updates exactly those cards.
- The page is unauthenticated by design (ADR-005). The report contains card text and the learner's wrong answers, which is what the page already shows card by card.
- Routes that write follow ADR-005, ADR-009, and ADR-011, and answer through `toErrorResponse`.

## Decision

1. **A leech is a review item** (a card, or one blank of a cloze card) whose `leech` flag is set and which is not archived. The list shows the full card, the deck, the lapse count, the repetitions, when it was last reviewed, whether the card is suspended, and the last few **wrong answers typed** (grade 1 reviews with a typed answer, newest first, at most 5, each cut to 200 characters, de-duplicated).
2. **Three actions, each a small POST** (`/api/leeches/:cardPk/:ordinal/reset`, `/api/cards/:cardPk/suspend`, `/api/cards/:cardPk/unsuspend`). _Reset_ clears the flag and sets lapses back to 0 and nothing else: the schedule, the stability, the review log, and the card text stay. It is for a card the learner has fixed by hand. _Suspend_ sets `cards.suspended` on the card, so every item of it leaves the queue and every count, and the card shows in the list as suspended with an Unsuspend button. Neither deletes anything, so neither needs a typed confirmation or a snapshot. Each is idempotent.
3. **Weak tags** are computed from the review log over a window (the last 90 days) and reviews in the _review_ phase only (`pre_phase = 2`, the reviews that measure retention; learning steps measure the learning steps). For each tag on a card (the card's own tags): reviews, retention (the share graded Hard, Good, or Easy), lapse rate (the share graded Again), and the number of cards. A tag needs **at least 10** such reviews to be ranked at all, so two bad reviews do not make a weak tag. Ranked weakest first by retention, then by more reviews, then by name. At most 10 are reported.
4. **The report** is one document, in Markdown for pasting and in JSON for tools, from `GET /api/report/weak-spots?format=md|json&deckId=`. Scope is all decks or one. It holds, in this order:
   - the **instruction to Claude**, first, because it is read first: what the cards are, what to change (make each card easier to learn, for example split a card that asks two things, add a mnemonic, make the question unambiguous), and the rules (keep every `id` and every card's `type`, return one deck block per deck in the same format, in one code block, containing **only the revised cards** and the `deck` object exactly as given). A pointer to the schema URL is included.
   - the **leech cards**, grouped by deck. Each deck is a ready-to-edit deck document (`{"tessera":1,"deck":{id,title},"cards":[...]}`) holding the leech cards in the exact format import reads, with a line for each card before it giving its lapse count, repetitions, and the wrong answers typed. Claude edits the block and sends it back, and importing it updates just those cards.
   - the **weakest tags**, as a table, with the note that they are for context.
   - a **note about anything left out**.
5. **The size is capped, never silently.** At most 40 leech cards and about 60,000 characters in all. Cards are added worst first (most lapses, then most recent) until the next would pass the cap; the rest are counted and the report says "N more leech cards are not shown; fix these, import, and ask again". Card text is never cut, because a half card cannot be returned and imported. A card larger than the cap on its own is skipped with a line saying so. The JSON form carries the same fields plus a `truncated` object.
6. **No leeches is not an error.** The report says so, still lists the weakest tags, and the instruction explains that there is nothing to rewrite.
7. **The page has two parts:** a Leeches page (the list, the three actions, the weakest tags, and a _Copy the weak-spot report for Claude_ button that copies the Markdown, falling back to a text box when the browser blocks copying, as the import page does), and a Leeches link on the deck list that shows the count. Suspended cards stay in the list so they can be put back.
8. **Security.** All routes follow the existing guards. The three POSTs are small bodies of no content that need the JSON content type. The report is read-only. It carries card text and typed answers, which the page already shows. Nothing from a request is echoed.

## Alternatives Considered

| Alternative                                                    | Pros                                                          | Cons                                                                                                    | Why Not                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Auto-suspend a leech at the threshold (Anki's default)         | Fewer failing cards in the queue                              | Hides the cards the learner most needs to see; the owner's spec says "not auto-suspended"               | The point is to rewrite them, not bury them                                     |
| Report as prose only                                           | Easy to read                                                  | Claude has to retype each card, and ids can be mangled                                                  | A ready-to-edit deck block keeps ids exact and imports without work            |
| Report holds the whole deck                                    | Simple for Claude                                             | Far over a prompt for a big deck, and the import then rewrites cards that did not change                | Import already leaves cards it does not mention alone                           |
| Cut long cards to fit the cap                                  | Always fits                                                   | A cut card cannot be returned                                                                           | Leave cards out and say so                                                      |
| Weak tags from all reviews, with no minimum                    | No threshold to explain                                       | Two bad reviews make a "weak" tag                                                                       | A minimum count is the standard guard against noise                             |
| Weak tags include learning-phase reviews                       | More data                                                     | Learning steps are repeated by design, so they flatter or punish a tag for the wrong reason             | True retention is measured on review-phase reviews                              |
| Reset also resets the schedule                                 | One concept                                                   | Throws away good history for a card that was only reworded                                              | Start over (a deck) already covers wiping a schedule                            |

## Consequences

### Positive

- The round trip closes with one copy and one paste in each direction, and what comes back imports without edits.
- Leeches become visible and workable, not only counted.
- No schema change: the flag, the review log, and the suspended column already exist.

### Negative

- A learner whose leeches are all very long cards sees "more not shown" and needs a second round.
- The report is only as good as the instruction wording, which may need tuning after real use.

### Risks

- Claude changes a card's type or id. Mitigation: the instruction says not to, the import preview shows a type change with the progress it would erase, and the deck block carries the ids.
- The report text could be mistaken for an instruction from the learner by a model that also holds tool access. Mitigation: it is plain text the learner pastes by hand into a chat they control. Card text is the learner's own and Claude's own earlier output.
- The wrong answers typed are the learner's input and can hold anything. They are shown as data in the report, fenced, and cut to 200 characters.

## Dependencies

- Depends on: ADR-002 (stable ids and idempotent import), ADR-003 (the review log and `pre_phase`), ADR-013 (a card keeps its type), ADR-005, ADR-009, ADR-011.
- Constrains: the Claude skill (it explains the loop), the security probe (every new route), and the live-image harness.
