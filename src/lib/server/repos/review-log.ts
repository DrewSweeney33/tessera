import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cards, reviewLog, type NewReviewLogRow, type ReviewLogRow } from '../db/schema.ts';

// The log is append-only, with one exception: undoing the newest answer deletes that one row (ADR-019). The two
// delete functions below are the only way, each limited to one mode, so a study undo can never remove a practice row
// and the reverse.
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

// The id of the newest row of a mode, or undefined when there is none. Rows written in the same millisecond are
// ordered by when they were inserted.
export function newestReviewLogId(x: Executor, mode: 'review' | 'cram'): string | undefined {
	return x
		.select({ id: reviewLog.id })
		.from(reviewLog)
		.where(eq(reviewLog.mode, mode))
		.orderBy(desc(reviewLog.reviewedAt), sql`rowid desc`)
		.limit(1)
		.get()?.id;
}

// Removes one study answer (undo, ADR-019). Returns how many rows went: 0 when the id is not a study answer.
export function deleteStudyLog(x: Executor, id: string): number {
	return x
		.delete(reviewLog)
		.where(and(eq(reviewLog.id, id), eq(reviewLog.mode, 'review')))
		.run().changes;
}

// Removes one practice answer (undo, ADR-019). Returns how many rows went: 0 when the id is not a practice answer.
export function deletePracticeLog(x: Executor, id: string): number {
	return x
		.delete(reviewLog)
		.where(and(eq(reviewLog.id, id), eq(reviewLog.mode, 'cram')))
		.run().changes;
}
