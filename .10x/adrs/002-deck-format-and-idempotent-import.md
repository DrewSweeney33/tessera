# ADR-002: Deck Format and Idempotent Import

**Status:** Accepted
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + Staff Engineer)

## Context

The core value of Tessera is the loop: Claude writes a deck, Tessera imports it, the learner studies, weak cards go back to Claude, a revised deck comes back. That loop only works if re-importing is safe: updated cards must keep their review history, nothing may be silently deleted, and errors must be specific enough for Claude to fix.

Two authoring formats were requested: JSON and Markdown. Both must behave identically.

## Decision

### Format layering

1. **One canonical model.** Zod schemas in `src/lib/core/schema/` define `Deck` and four card types (`basic`, `cloze`, `typed`, `choice`). All schemas use `z.strictObject`, so unknown fields are rejected.
2. **Two front ends, one validator.** `parseJson(text)` and `parseMarkdown(text)` both produce a plain object shaped like the JSON format, then call the same `validateDeck(obj)`. The Markdown parser never validates by itself.
3. **Versioned.** `tessera: 1` is required. A different value yields a clear "unsupported version" error.

### Markdown parser

- Hand-written line-based state machine, not a Markdown AST library. Card sections start at `## <id>`. Field labels (`Q:`, `A:`, `Answer:`, `Accept:`, `Cloze:`, `Choices:`, `Explanation:`, `Hint:`, `Tags:`, `Source:`, `Type:`) are recognized only at line start and never inside fenced code blocks.
- Frontmatter is parsed with the `yaml` package (2.9.x, ISC), core schema only, no custom tags, `maxAliasCount: 10`. **`gray-matter` is explicitly rejected**: it depends on `js-yaml` 3 and supports `---js` frontmatter that executes code.
- Type inference: `Cloze:` is cloze, `Q:` plus `Choices:` is choice, `Q:` plus `Answer:` is typed, `Q:` plus `A:` is basic. `Type:` overrides.
- Choices use list items with `- [x]` marking the correct one. Exactly one must be marked.

### Identity and change detection

- Card identity is `(deck_id, key)`, where `key` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
- If `id` is omitted, `key = "h-" + first 12 hex chars of SHA-256(normalized primary text)`. The importer emits a warning that edits to that text will create a new card.
- `content_hash` is SHA-256 over canonical JSON of the full normalized card (sorted keys, Unicode NFC, `\r\n` converted to `\n`, trailing whitespace trimmed per field), including tags, hint, and source.
- A card gains a `position` integer (its index in the file). It orders new cards. This column is an addition to the spec's data model.

### Reconciliation rules

| Situation | Result |
|---|---|
| Key not present in deck | **New.** Card row and `card_state` rows in state New. |
| Key present, hash equal | **Unchanged.** No write. |
| Key present, hash differs, same type | **Updated.** Content, tags, source, position replaced. All schedule state kept. |
| Key present, type changed | **Updated with reset.** `card_state` rows replaced. The preview flags it as "type changed, progress reset". |
| Cloze numbers added | New `card_state` rows for new ordinals. |
| Cloze numbers removed | `card_state` rows for removed ordinals get `archived = 1` and leave the queue. Their `review_log` history is kept. If the number returns later, the row is restored. |
| Key absent from file | **Untouched.** With `archive_missing=true` the card is set `archived=1`. |
| Archived card reappears in a later import | Restored (`archived=0`) with its schedule intact. |
| Same `deck.id` as an existing deck | Merge into that deck. Deck title, description, tags are updated from the file. |

Nothing is ever hard-deleted by an import.

### Pipeline

1. `planImport(deck)` is a pure function over a read-only snapshot of existing cards. It returns the plan and counts.
2. `dry_run=true` and the UI preview return the plan only.
3. `commitImport(deck)` opens a single `db.transaction`, **recomputes the plan inside the transaction** (never trusts a stale preview), applies it, writes an `import_history` row, and commits. Any error rolls back everything.

### Errors

Each error is `{ path, code, message, allowed? }`, for example `{ "path": "cards[12].choices", "code": "too_few", "message": "choice cards need 2 to 8 choices, found 1" }`. At most 50 errors are returned, sorted by position. Markdown errors add `line` numbers. The UI's "Copy errors for Claude" builds a fix-request prompt from this list.

### Limits

5 MB body, 5,000 cards, 20,000 characters per text field, 32 tags per card, 40 characters per tag, 8 choices.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| JSON only | One parser, simplest | Claude and humans find Markdown easier to write and read. Decks stored in a vault read badly as JSON. | User explicitly asked for both. |
| Markdown only | Human-friendly | Looser validation, awkward for nested choices and long cloze text | JSON is the reliable machine format for the API. |
| Native Anki `.apkg` or CSV import | Instant access to existing decks | Binary format, no strict schema, no Claude-fixable errors, large surface | Out of scope for v1. Could be a separate converter later. |
| Identify cards by content hash only | No ids to author | Editing a card creates a new card and orphans its history, which breaks the weak-spot rewrite loop | Stable ids are the point. Hash is only the fallback. |
| Replace-all on import | Simple to reason about | Destroys review history | Violates the core product promise. |
| `gray-matter` for frontmatter | Convenient | JavaScript frontmatter engine and old `js-yaml` | Security risk for untrusted input. |

## Consequences

### Positive

- Updating a deck is safe, so "rewrite my leeches, re-import" works without fear.
- One validator means both formats have identical behavior, and error messages are uniform.
- Strict objects catch Claude hallucinating fields, and the error says exactly which.

### Negative

- Hand-written Markdown parser needs thorough tests (fences, labels inside code, CRLF, blank lines).
- Stable ids put a burden on the authoring side, mitigated by the Claude skill instructing it to always emit ids.
- Archiving removed cloze ordinals leaves rows behind. Cost is trivial.

### Risks

| Risk | Mitigation |
|---|---|
| Claude reuses an id for a different card, silently overwriting content | Preview lists updated cards with a before/after diff of changed fields. |
| Claude renames all ids in a revision | Preview shows "N new, M absent". The UI warns when most cards are new and most existing are absent, and offers a guide to map ids. |
| Parser divergence between JSON and Markdown | Property test: generate decks, serialize both ways, assert equal validated output. |

## Dependencies

- Depends on ADR-001 (Zod, Drizzle transaction support).
- Constrains ADR-003 (card_state rows are keyed by `(card_pk, ordinal)`), and the export unit (must emit ids and be round-trippable).
