import type { ImportError } from '#lib/core/schema/errors.ts';
import { canonicalJson } from '#lib/core/schema/normalize.ts';
import type { Executor } from '../db/client.ts';
import { sha256Hex } from '../import/hash.ts';
import { getDeck, listCardsForDeck } from '../repos/index.ts';

// A fingerprint of everything an editor shows about a deck: its title, description, and tags, whether it is in the
// Trash, and every card's key, content hash, place in the order, and whether it was removed (ADR-013). An editor sends
// the revision it loaded, and the server refuses a save made from a copy that is out of date.
//
// A deck's updatedAt cannot do this: it changes only when the title, description, or tags do, not when a card does.
// Study progress, import history, and housekeeping timestamps are left out on purpose, so studying a deck in another
// tab does not make an open editor stale. Nothing for a deck that does not exist.
export function deckRevision(x: Executor, deckId: string): string | undefined {
	const deck = getDeck(x, deckId);
	if (!deck) return undefined;
	return sha256Hex(
		canonicalJson({
			deck: {
				id: deck.id,
				title: deck.title,
				description: deck.description,
				tags: deck.tags,
				archived: deck.archived
			},
			cards: listCardsForDeck(x, deckId).map((card) => [
				card.key,
				card.contentHash,
				card.position,
				card.archived
			])
		})
	);
}

// The problem to report when a save was made from a copy of the deck that is out of date, or nothing when the copy is
// current. Used inside the import's transaction (so nothing can slip in between the check and the write) and by the
// preview, which only needs to warn early.
export function staleRevisionProblem(
	x: Executor,
	deckId: string,
	expected: string
): ImportError | undefined {
	const current = deckRevision(x, deckId);
	if (current === expected) return undefined;
	return {
		path: 'deck',
		code: 'changed_elsewhere',
		message:
			current === undefined
				? 'This deck no longer exists, so your changes cannot be saved to it.'
				: 'This deck was changed since you opened it, so nothing was saved. Reload the deck and make your changes again.'
	};
}
