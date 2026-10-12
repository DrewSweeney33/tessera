# ADR-013: Editing, deleting, and resetting decks in the GUI

**Status:** Accepted by the owner on 2026-10-12, with the assumptions listed in the product requirements file ("Questions for the owner")
**Date:** 2026-10-12
**Feature:** tessera-v1 (library management: user stories US-11 to US-14)
**Author:** 10x-Team (Architect + Staff Engineer + Security)

## Context

Tessera is file-first: a deck is a document with stable ids, imported through one validated path (parse, validate, plan, preview, commit). Re-import by id keeps progress, shows a preview of what changes, and writes atomically. That path is the most tested part of the system (property tests, a mutation check, a durability check, 5,000-card benchmarks).

The owner wants to manage decks by hand: create one, add, edit, and remove cards, delete a deck, and start a deck over. Each is a write that the file path does not offer today. Constraints from what exists:

- Decks and cards already have an `archived` flag, and re-import has an `archive_missing` option, so "hidden but kept" is already a state with meaning.
- Cards own their scheduling state and review log: `card_state` and `review_log` are deleted with their card (`ON DELETE CASCADE`). Deleting a card permanently deletes its history.
- Card text changes keep progress, because progress belongs to the card id. A card type change erases it, and import warns about that.
- The server has no accounts. Write routes are protected by the host check, JSON-only requests, and (for callers that are not the page) the optional API token. The page itself is unauthenticated by design (ADR-005, ADR-009, ADR-011).
- Every migration is forward-only (ADR-008), and a backup is written before one.

## Decision

1. **Manual edits go through the existing import pipeline, not a second write path.** The editor builds a deck document from the current deck (the same content `exportDeck` produces) with the owner's changes applied, and submits it as an import for the same deck id. The existing plan and commit steps validate it, show a preview where useful, keep progress for unchanged ids, archive on request, and write atomically. A new card gets a generated id that passes the id rules. This needs `exportDeck` (M3-06) first.
2. **Creating a deck** is an import of a document with a title and no cards (the schema must allow an empty cards list for that route, or the route creates the deck row directly with the same validation). The id is a slug of the title, checked for uniqueness, editable before the first save.
3. **Removing a card archives it by default.** Its progress and history stay and it can be restored. Permanent removal is a separate, confirmed action.
4. **Deleting a deck is two steps.** Delete sets the deck's `archived` flag (the **Trash**), hides it from every list and from the study queue, and keeps cards, state, and history. From the Trash a deck is restored, or deleted permanently. Permanent deletion needs the deck title typed as confirmation, says that the deck's review history is deleted with it, and runs only after an automatic snapshot (ADR-014 mechanism).
5. **Start over** (reset progress) replaces a deck's card state with fresh new-card state, keeps the review log (so statistics and the audit trail are not lost, and it is marked as before a reset), needs a typed confirmation, and runs only after an automatic snapshot. It is separate from **Practice again** (cram mode, M4), which never changes the schedule.
6. **Every destructive action takes a snapshot first**, with the same `VACUUM INTO` mechanism the upgrade backup and the manual backup use, into the data folder's `backups` folder, and tells the owner its name. If the snapshot cannot be written (disk full), the destructive action does not run.
7. **Re-import after a hand edit** treats the hand edit like any other difference: the preview shows the old and new text and the owner decides. There is no "locked card" feature in the first cut.
8. **No new write surface beyond three:** the import route (existing), a trash and restore route (sets one flag), and a start-over route. Each goes through `toErrorResponse`, the host check, the content-type guard, and the token rule, and each gets probe entries.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Per-card CRUD routes (`PATCH /api/cards/:id`, `DELETE ...`) | Small requests, familiar | A second write path to validate, keep atomic, test, and probe. Duplicates the planner's rules (card type change, hashing, positions). More surface for an unauthenticated page. | The import pipeline already does this and is the best-tested code. A whole-deck write for one card costs about 0.2 to 0.4 s at 5,000 cards (measured), which is acceptable for a manual edit. |
| Hard-delete a deck at once | Simple, matches what most people expect | One misclick destroys months of review history, the most valuable data | The history is the asset. Trash is cheap because `archived` already exists. |
| A locked or "edited by hand" flag on cards, so re-import skips them | Protects hand edits | A migration, a new concept, and a second source of truth rules | The preview already shows the overwrite. Revisit if the owner finds it painful. |
| Keep the app file-only and have Claude do all edits | No new surface | The owner has asked for this, and it blocks daily use | The request is explicit. |
| Undo history for edits | Safest | Needs an edit log and retention rules | Snapshots before destructive actions give most of the safety for a fraction of the cost. |

## Consequences

### Positive
- One write path stays the only write path for card content. The edit feature inherits validation, atomicity, durability tests, and the preview.
- Trash needs no migration. Restore is one flag.
- A mistake is recoverable: Trash, archive-by-default, and a snapshot before every destructive action.

### Negative
- The editor depends on export (M3-06) being built first, and on the planner accepting an empty deck (a small change).
- A whole-deck rewrite per card edit writes more than needed. Fine at the current limits, to be measured on the real host with the harness.
- "Permanent delete" really deletes review history. The wording of the confirmation matters.

### Risks
- A hand edit and a later Claude re-import disagree. Mitigation: the preview, and the documentation that says so.
- Concurrent edits (two tabs) overwrite each other. Mitigation: the editor sends the deck's `updatedAt` it loaded and the server refuses a stale write with a clear message (the same idea as the stale-review check).
- A destructive action on a full disk. Mitigation: no snapshot, no action.
- A new write surface on an unauthenticated page. Mitigation: the existing guards, probe entries for every new route, and the security review at the milestone exit.

## Dependencies
- Depends on: ADR-002 (deck format and idempotent import), ADR-008 (forward-only migrations, snapshots), ADR-005, ADR-009, ADR-011 (security posture), M3-06 (`exportDeck`).
- Constrains: ADR-014 (backups and restore from the GUI), the cram mode design (M4), and the Claude skill (it should say that hand edits exist and that re-import shows them).
