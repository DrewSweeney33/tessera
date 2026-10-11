import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { decks, type DeckRow } from '../db/schema.ts';

export interface DeckInput {
	id: string;
	title: string;
	description: string | undefined;
	tags: string[];
}

export function getDeck(x: Executor, id: string): DeckRow | undefined {
	return x.select().from(decks).where(eq(decks.id, id)).get();
}

export function listDecks(x: Executor, options: { includeArchived?: boolean } = {}): DeckRow[] {
	const query = x.select().from(decks);
	const rows = options.includeArchived ? query : query.where(eq(decks.archived, false));
	return rows.orderBy(asc(decks.title)).all();
}

// Creates the deck, or updates its title, description, and tags. Importing into an archived deck restores it.
export function upsertDeck(x: Executor, input: DeckInput, now: string): 'created' | 'updated' {
	const values = {
		title: input.title,
		description: input.description ?? null,
		tags: input.tags
	};
	if (!getDeck(x, input.id)) {
		x.insert(decks)
			.values({ id: input.id, ...values, createdAt: now, updatedAt: now })
			.run();
		return 'created';
	}
	x.update(decks)
		.set({ ...values, archived: false, updatedAt: now })
		.where(eq(decks.id, input.id))
		.run();
	return 'updated';
}
