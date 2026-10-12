# QA and security: Milestone 3 (leeches, weak-spot report, settings), 2026-10-12

**By:** QA Engineer and Security Engineer roles. **Scope:** the Leeches page and its three actions, weak tags, the weak-spot report (`GET /api/report/weak-spots`), the settings page and API, and the interleave change. **Design:** ADR-015. **Builds on:** the Milestone L reviews, whose findings S-11 and S-12 apply here too.

**Result:** no blocking findings. One new accepted risk (S-13) and one open question for the owner (the report wording). Not yet run on the real host: see the end.

## What was tested

| Part | Tests | Planted bugs |
|---|---|---|
| Leech list, reset, suspend | 25 integration | 8 + 12, all caught (4 tests added for survivors) |
| Weak tags | 15 integration | 9 + 6, all caught |
| Report builder (the contract with Claude) | 24 unit, incl. a property test | 20, all caught (5 tests added) |
| Leech and report routes | 40 integration | 12 + 3, all caught or equivalent |
| Settings check and routes | 37 unit (incl. a property test against the stored schema) + 17 integration | 6 + 8, all caught (1 test added) |
| Interleave | 8 integration plus the existing random-state property test | 9, all caught |
| Browser | 14 (leeches), 13 (settings), accessibility scans of both pages in light and dark, phone widths | |
| Probe | 65 + 32 new checks (591 in all) | |

The whole loop is one browser test: make a card a leech, fetch the report, take the deck block from it, change a card as Claude would, import it, and check that the card's text changed, the other card did not, and the lapse count and history are still there.

## Defects found by testing, fixed

1. **The settings page died with a 500 on the first keystroke.** Svelte's `bind:value` on a number input gives a number (or null), not text. Found by the browser tests.
2. **A report that ignored recency in its tie-break, repeated wrong answers beyond the limit, and an id parsed too leniently** (`5.0`, `0005`) were all found by planted bugs and are now tested.
3. **The "mix new and due cards" option only shuffled within each kind**, with due cards always first, so it did not do what its name said. Now one weighted draw.
4. **A flaky test**: the layer-lint test timed out at 5.2 seconds on a busy machine. Its timeout is realistic now.

## Security review

New surface: `GET /api/leeches`, `GET /api/report/weak-spots`, `POST /api/leeches/:cardPk/:ordinal/reset`, `POST /api/cards/:cardPk/suspend|unsuspend`, `GET` and `PUT /api/settings`. All sit behind the host check, the JSON-only rule, and the token rule. All are in the probe, including traversal and malformed ids, wrong methods, cross-site posts as `text/plain`, a form type, and multipart, a foreign `Host`, oversized and malformed bodies, and the token on every route (and a percent-encoded path variant of each family). A real suspend and put-back round trip is in the probe.

- **Path numbers.** A card number and a blank number in a path must be plain digits of limited length. `5.0`, `1e3`, `0x5`, `+5`, a space, and a zero-padded number are 404s, so a path means one thing.
- **Nothing typed is echoed.** The settings check never repeats what was sent, and names an unknown setting only if it looks like a plain name. Wrong answers typed by the learner appear in the report as JSON strings, cut to 200 characters, so they cannot pass for a line of the report or of the instruction.
- **The reset, suspend, and settings routes destroy nothing.** Reset clears a flag and a count and nothing else. Suspend flips one column. A settings change is all or nothing in one transaction (tested by breaking the second write on purpose). None needs a snapshot or a typed word, and each is idempotent.
- **The report is read-only and holds what the page already shows**: card text, the lapse counts, and the learner's wrong answers.

**S-13 (accepted risk): the report is text the learner pastes into a chat with a model, and it contains the learner's own wrong answers and Claude's earlier output.** A wrong answer is the learner's input and could be written to look like an instruction. It is shown as quoted data, on one line, in a fixed place, and the model only ever sees it because the learner pasted it. There is no other path. The residual risk is a learner who types a hostile answer to themselves. No action.

**Observation:** the report contains a pointer to the schema built from the address the request came to (`url.origin`). Behind a reverse proxy that address is the public one when `PROTOCOL_HEADER` and `HOST_HEADER` are set, as the deployment guide says. It is never a path on the server.

## Open question for the owner

The wording of the instruction to Claude (in `src/lib/core/weak-spots.ts`, `INSTRUCTION`) is a first draft. It asks for only the revised cards, with ids and types kept, in a deck block per deck. After you try it with Claude on real leeches, tell me what it got wrong and I will tune it. The test suite pins the rules (ids and types kept, only revised cards, the schema pointer), not the exact wording.

## Not tested

- **The real host.** The live-image harness has no steps for the leech or settings routes yet. They are covered by the probe, which the harness runs against the real image, but a run of the whole harness has not been done since these were added.
- **A leech list or a weak-tag query over a very large review log** (hundreds of thousands of reviews). The weak-tag query aggregates per card in SQL first, and the leech list asks one extra query per leech for its wrong answers. At the report's cap of 40 cards this is small; the list page is not capped. Worth a benchmark before a user has hundreds of leeches.
- **A phone or a screen reader.** Unchanged and still open (R-3, R-10).
