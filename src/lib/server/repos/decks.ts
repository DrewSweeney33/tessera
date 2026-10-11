import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { decks, type DeckRow } from '../db/schema.ts';

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
