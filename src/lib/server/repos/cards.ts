import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cards, type CardRow, type NewCardRow } from '../db/schema.ts';

export type CardPatch = Partial<
	Pick<
		NewCardRow,
		'type' | 'content' | 'tags' | 'source' | 'contentHash' | 'position' | 'archived' | 'updatedAt'
	>
>;

// Every card in a deck, archived ones included, in file order. Used to plan imports.
export function listCardsForDeck(x: Executor, deckId: string): CardRow[] {
	return x.select().from(cards).where(eq(cards.deckId, deckId)).orderBy(asc(cards.position)).all();
}

export function getCard(x: Executor, pk: number): CardRow | undefined {
	return x.select().from(cards).where(eq(cards.pk, pk)).get();
}

export function getCardByKey(x: Executor, deckId: string, key: string): CardRow | undefined {
	return x
		.select()
		.from(cards)
		.where(and(eq(cards.deckId, deckId), eq(cards.key, key)))
		.get();
}

// Number of active (not archived) cards per deck id.
export function countActiveCardsByDeck(x: Executor): Map<string, number> {
	const rows = x
		.select({ deckId: cards.deckId, total: count() })
		.from(cards)
		.where(eq(cards.archived, false))
		.groupBy(cards.deckId)
		.all();
	return new Map(rows.map((row) => [row.deckId, row.total]));
}

// Returns the new card's primary key.
export function insertCard(x: Executor, row: NewCardRow): number {
	return x.insert(cards).values(row).returning({ pk: cards.pk }).get().pk;
}

export function updateCard(x: Executor, pk: number, patch: CardPatch): void {
	x.update(cards).set(patch).where(eq(cards.pk, pk)).run();
}

export function setCardsArchived(x: Executor, pks: number[], archived: boolean, now: string): void {
	if (pks.length === 0) return;
	x.update(cards).set({ archived, updatedAt: now }).where(inArray(cards.pk, pks)).run();
}
