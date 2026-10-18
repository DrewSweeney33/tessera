# QA and security: Milestone 6 (study quality), 2026-10-18

**By:** QA Engineer and Security Engineer roles. **Scope:** undo of the last answer in study and practice (`POST /api/study/undo`, `POST /api/practice/undo`), card order in the editor (Move up and Move down), practice by tag (`tag` scope, `?tag=`), and Quiz me in Practice (`quiz`, `quizSeed`, `core/quiz.ts`). **Build reviewed:** the working tree on top of `d25d32e` (0.2.1), not committed.

**Result:** no blocking findings. Two accepted risks (S-17, S-18) and five defects found by testing, all fixed. Not verified: a real phone, Firefox on this machine (it cannot launch here), the whole WebKit suite locally (the new specs and the affected old ones pass on WebKit; CI runs all of it), and a click-through of undo on the live data (nothing was graded on CT123, on purpose).

## What was tested

| Part | Tests | Planted bugs |
|---|---|---|
| Undo of a study answer: the whole `card_state` row, the siblings, the log, reviews today, the new-card allowance, and the queue counts compared before the answer and after the undo, for every grade (1 to 4) and every starting phase (new, learning, review, relearning) | 27 integration | 6 (a column restored wrong, the leech flag kept, cloze siblings left buried, the log row kept, an answer that is not the newest accepted, a changed card accepted), all caught |
| Undo guards and answers: 404, 409, strict bodies, a practice row cannot be undone as a study answer and the reverse, the two routes over HTTP | 10 integration (API) | |
| Practice undo: removes exactly one `cram` row and nothing else, schedules untouched | covered in the API tests and in `undo.spec.ts` | |
| Undo in the browser: button, `U`, Ctrl and Cmd with `Z`, the finished screen, a second tab, typing in an answer box, accessibility in both themes, 320 px | 10 e2e (Chromium and WebKit) | |
| Card order: `changeSummary` order detection (an added or removed card is not an order change), `moveCard`, a reorder through the save path keeps ids and states and changes the revision, a stale save is still refused | 5 unit, 2 integration | |
| Card order in the browser: keyboard, focus stays on the button, the bar says "card order changed", saved order survives a reload and is the study order, move and move back is no change, buttons wait during a search, another tab, 44 px at 320 px | 5 e2e | |
| Practice by tag: the pool (exact match, Trash, suspended, removed, cloze items), hostile tags as plain text, the schedule promise with a tag scope, the routes and their refusals | 7 integration, 6 API | |
| Practice by tag in the browser: from Statistics and from Leeches, only the tag's cards, schedule untouched, nothing to practice, one scope in the address, resume, 44 px at 320 px | 6 e2e | |
| Quiz builder (`core/quiz.ts`): answers, usable text, determinism, no duplicates, same-deck preference, too few candidates | 19 unit | 10 (the right answer missing, repeated, wrong index, multi-line allowed, not repeatable, a Trash deck used, a cloze made a question, and others), all caught but one that is equivalent (the card's own answer is already removed by the duplicate rule) |
| Quiz server item and start: shape, determinism, sources, writes nothing | 13 integration, 5 API | |
| Quiz in the browser: four options with the right answer once, wrong pick and loop-back, reload and resume keep the order, typed card, cloze unchanged, off by default, 44 px at 320 px, accessibility in both themes | 9 e2e (Chromium and WebKit) | |
| Probe | 107 new checks (900 in all), and the remote check that runs it twice | |

Totals: unit 1,327, integration 973, `security:probe` 900 checks with no failure, `probe:remote-check` passes, the full Chromium suite passes after the last change.

## Defects found by testing, fixed

1. **A reorder alone looked like "no changes".** The editor's change count compared cards by id, not by order, so after moving a card the bar said "No changes yet" and Save stayed disabled. `changeSummary` now has `reordered`, counted among the cards both lists share. A save of a reorder is not counted as a change by the import (`changed: false`, the position is applied as housekeeping), so the editor says "The new card order is kept".
2. **Cloze items are numbered from 1.** Only a mistake in my first test (item 0 does not exist); the code was right.
3. **Five tests of mine were timing-sensitive** and failed once each on WebKit or under load: measuring right after the page redrew, reading a card while the old one was still on screen (disabled options), waiting for a "Show answer" button that never comes after the last card, reading the list before it had loaded, and a heading measured in the loading state. Each now waits for the state it needs and was repeated on fresh servers. The lessons are in the vault's Tessera-Gotchas note.
4. **`undo` already existed as an icon.** A duplicate key broke lint; the existing icon is used.
5. **Quiz options are shuffled again by the choice card code** (its own stable order). Harmless: the options and their order are still fixed for the session; recorded so nobody wonders.

## Security review

**New surface:** `POST /api/study/undo`, `POST /api/practice/undo`; `tag` and `quiz` on `POST /api/practice/start`; `?tag=` on `GET /api/practice/pool`; `quizSeed` on `GET /api/practice/item`.

- **Guards.** Every route sits behind the host check, the JSON content-type rule, the cross-site guard, and the API token (ADR-009), has a strict Zod body, a bounded id or seed, and probe checks (wrong methods, cross-site POST, oversized bodies, malformed and hostile bodies, `__proto__`, unknown fields, the token rule for each new route).
- **A tag is never put into SQL text.** The pool filters with `exists (select 1 from json_each(cards.tags) where json_each.value = ?)`, the tag is a bound parameter, and the probe sends quotes, `drop table`, `%`, `_`, backslash, markup, and template syntax as tags: each is an empty pool and the tables are intact. A tag must also match the pattern a card tag has (no commas or line breaks, at most 40 characters).
- **The quiz seed is letters and digits only** (8 to 32), compared to nothing and stored nowhere on the server; it only decides an order. Hostile seeds are refused with a 400 and no leak.
- **Quiz reads only the owner's own cards** and sends nothing anywhere. It writes nothing (a test compares every table before and after 75 questions).
- **Undo is the only new writer of `card_state`.** It is confined to `server/study/undo.ts`; practice code may delete only its own `cram` row (`deletePracticeLog`, with a mode condition in SQL), enforced by the ESLint confinement from ADR-017, and a study undo cannot remove a practice row or the reverse (tested both ways).
- **Layering held:** practice code still cannot import the scheduler or the study module.

**S-17 (accepted, same class as S-11): an undo deletes a history row.** Anyone who can reach the page can already grade a card, delete a deck for good, and restore a backup; they can now also take back an answer. The deleted row is not recoverable except from a backup. Milestone 7 (the optional page password) closes the whole class.

**S-18 (accepted, ADR-019): a delayed duplicate of the original answer request, arriving after an undo, would grade the card again** because the id is free again. It needs a request stuck in the network for a full round trip; the client does not retry grades; the effect is one extra grade that can be undone again. A tombstone table would close it but needs a migration. Revisit if a client retry is ever added.

**Performance note.** The tag pool reads every active card's tags once (a scan, 2,346 cards on the live data, instant). It was not benchmarked at 100,000 cards; the quiz reads at most 300 candidate cards per question. If a huge library ever feels slow, a tag index table is the answer and needs a migration.

## Release readiness

Ready to release (0.3.0 or 0.2.2, the owner's choice, no migration in any slice). Still the owner's: the real-phone pass (`docs/phone-checklist.md`, now with undo, order buttons, practice by tag, and Quiz me), and the decision to commit, push, and tag. CI will run the whole three-browser suite once pushed.
