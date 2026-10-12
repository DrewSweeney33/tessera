import { count, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cards, reviewLog, type NewReviewLogRow, type ReviewLogRow } from '../db/schema.ts';

// The log is append-only: there is no update or delete.
export function insertReviewLog(x: Executor, row: NewReviewLogRow): void {
	x.insert(reviewLog).values(row).run();
}

export function getReviewLog(x: Executor, id: string): ReviewLogRow | undefined {
	return x.select().from(reviewLog).where(eq(reviewLog.id, id)).get();
}

// Reviews recorded on the cards of a deck, which is the history that deleting the deck for good would erase.
export function countReviewsForDeck(x: Executor, deckId: string): number {
	return (
		x
			.select({ total: count() })
			.from(reviewLog)
			.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
			.where(eq(cards.deckId, deckId))
			.get()?.total ?? 0
	);
}
