import { asc, desc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cards, deckResets, decks, importHistory, type DeckRow } from '../db/schema.ts';

export interface DeckInput {
	id: string;
	title: string;
	// On update, an omitted (undefined) description or tag list leaves the stored value alone,
	// so a revised deck file that leaves them out never erases them. An explicit empty value clears.
	description: string | undefined;
	tags: string[] | undefined;
}

export function getDeck(x: Executor, id: string): DeckRow | undefined {
	return x.select().from(decks).where(eq(decks.id, id)).get();
}

export function listDecks(x: Executor, options: { includeArchived?: boolean } = {}): DeckRow[] {
	const query = x.select().from(decks);
	const rows = options.includeArchived ? query : query.where(eq(decks.archived, false));
	return rows.orderBy(asc(decks.title)).all();
}

// Creates the deck, or updates its title and any description or tags that were provided.
// Importing into an archived deck restores it.
export function upsertDeck(x: Executor, input: DeckInput, now: string): 'created' | 'updated' {
	if (!getDeck(x, input.id)) {
		x.insert(decks)
			.values({
				id: input.id,
				title: input.title,
				description: input.description ?? null,
				tags: input.tags ?? [],
				createdAt: now,
				updatedAt: now
			})
			.run();
		return 'created';
	}
	x.update(decks)
		.set({
			title: input.title,
			...(input.description !== undefined ? { description: input.description } : {}),
			...(input.tags !== undefined ? { tags: input.tags } : {}),
			archived: false,
			updatedAt: now
		})
		.where(eq(decks.id, input.id))
		.run();
	return 'updated';
}

// Decks in the Trash, the most recently moved there first (moving a deck there sets its updatedAt).
export function listArchivedDecks(x: Executor): DeckRow[] {
	return x
		.select()
		.from(decks)
		.where(eq(decks.archived, true))
		.orderBy(desc(decks.updatedAt))
		.all();
}

// Moves a deck to the Trash (archived) or back. Cards, schedule, and history are not touched.
export function setDeckArchived(x: Executor, id: string, archived: boolean, now: string): void {
	x.update(decks).set({ archived, updatedAt: now }).where(eq(decks.id, id)).run();
}

// Removes a deck and everything that belongs to it: cards (their schedule and review history go with them,
// ON DELETE CASCADE), import history, and the record of resets. Only permanent deletion from the Trash calls this (ADR-013), after
// a snapshot. Everything else keeps review history for good.
export function deleteDeckAndData(x: Executor, id: string): void {
	x.delete(cards).where(eq(cards.deckId, id)).run();
	x.delete(importHistory).where(eq(importHistory.deckId, id)).run();
	x.delete(deckResets).where(eq(deckResets.deckId, id)).run();
	x.delete(decks).where(eq(decks.id, id)).run();
}
