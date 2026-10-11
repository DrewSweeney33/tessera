import type { Deck } from '#lib/core/schema/index.ts';
import { normalizeCard, reviewOrdinals } from '#lib/core/schema/normalize.ts';
import type { Executor } from '#lib/server/db/index.ts';
import { fallbackKey, hashCard } from '#lib/server/import/hash.ts';
import { insertCard, insertStates, upsertDeck } from '#lib/server/repos/index.ts';

// Writes a deck into the database the way a first import would, using repositories directly.
// Plan tests use this so they do not depend on commitImport.
export function seedDeck(
	x: Executor,
	deck: Deck,
	now = '2026-10-10T12:00:00.000Z'
): Map<string, number> {
	upsertDeck(
		x,
		{
			id: deck.deck.id,
			title: deck.deck.title,
			description: deck.deck.description,
			tags: deck.deck.tags ?? []
		},
		now
	);
	const pks = new Map<string, number>();
	deck.cards.forEach((card, index) => {
		const normalized = normalizeCard(card);
		const key = normalized.id ?? fallbackKey(normalized);
		const pk = insertCard(x, {
			deckId: deck.deck.id,
			key,
			type: normalized.type,
			content: normalized.content,
			tags: normalized.tags,
			source: normalized.source ?? null,
			contentHash: hashCard(normalized),
			position: index,
			createdAt: now,
			updatedAt: now
		});
		insertStates(
			x,
			reviewOrdinals(normalized).map((ordinal) => ({ cardPk: pk, ordinal, due: now }))
		);
		pks.set(key, pk);
	});
	return pks;
}
