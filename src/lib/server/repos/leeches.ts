import { and, asc, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cardState, cards, decks, reviewLog } from '../db/schema.ts';

export interface LeechRow {
	cardPk: number;
	ordinal: number;
	deckId: string;
	deckTitle: string;
	key: string;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	content: Record<string, unknown>;
	tags: string[];
	source: string | null;
	lapses: number;
	reps: number;
	lastReview: string | null;
	suspended: boolean;
}

// Review items flagged as leeches, worst first: the most lapses, then the most recently reviewed, then by card id.
// Items of removed cards, removed blanks, and decks in the Trash are not leeches anyone can work on, so they are left
// out. A suspended card stays, so it can be put back.
export function selectLeechRows(x: Executor, options: { deckId?: string } = {}): LeechRow[] {
	const conditions = [
		eq(cardState.leech, true),
		eq(cardState.archived, false),
		eq(cards.archived, false),
		eq(decks.archived, false),
		...(options.deckId === undefined ? [] : [eq(cards.deckId, options.deckId)])
	];
	return x
		.select({
			cardPk: cardState.cardPk,
			ordinal: cardState.ordinal,
			deckId: decks.id,
			deckTitle: decks.title,
			key: cards.key,
			type: cards.type,
			content: cards.content,
			tags: cards.tags,
			source: cards.source,
			lapses: cardState.lapses,
			reps: cardState.reps,
			lastReview: cardState.lastReview,
			suspended: cards.suspended
		})
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...conditions))
		.orderBy(
			desc(cardState.lapses),
			desc(cardState.lastReview),
			asc(cards.key),
			asc(cardState.ordinal)
		)
		.all();
}

// How many leeches still need attention: flagged, and not suspended.
export function countOpenLeeches(x: Executor): number {
	return (
		x
			.select({ total: count() })
			.from(cardState)
			.innerJoin(cards, eq(cards.pk, cardState.cardPk))
			.innerJoin(decks, eq(decks.id, cards.deckId))
			.where(
				and(
					eq(cardState.leech, true),
					eq(cardState.archived, false),
					eq(cards.archived, false),
					eq(cards.suspended, false),
					eq(decks.archived, false)
				)
			)
			.get()?.total ?? 0
	);
}

// The typed answers that were wrong (graded Again) for one item, newest first. Many more than are shown are read
// so that repeats and blanks do not use up the room.
export function wrongTypedAnswers(x: Executor, cardPk: number, ordinal: number): string[] {
	return x
		.select({ typed: reviewLog.typedAnswer })
		.from(reviewLog)
		.where(
			and(
				eq(reviewLog.cardPk, cardPk),
				eq(reviewLog.ordinal, ordinal),
				eq(reviewLog.grade, 1),
				isNotNull(reviewLog.typedAnswer)
			)
		)
		.orderBy(desc(reviewLog.reviewedAt), desc(reviewLog.id))
		.limit(60)
		.all()
		.map((row) => row.typed ?? '');
}

// An item in a deck that is in the deck list, with what is needed to check that before changing it.
export function findLiveItem(
	x: Executor,
	cardPk: number,
	ordinal: number
): { suspended: boolean } | undefined {
	return x
		.select({ suspended: cards.suspended })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(cardState.cardPk, cardPk),
				eq(cardState.ordinal, ordinal),
				eq(cards.archived, false),
				eq(decks.archived, false)
			)
		)
		.get();
}

export function findLiveCard(x: Executor, cardPk: number): { suspended: boolean } | undefined {
	return x
		.select({ suspended: cards.suspended })
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(eq(cards.pk, cardPk), eq(cards.archived, false), eq(decks.archived, false)))
		.get();
}

// Clears the flag and the lapse count of one item. The schedule, the log, and the card are not touched.
export function clearLeech(x: Executor, cardPk: number, ordinal: number): void {
	x.update(cardState)
		.set({ leech: false, lapses: 0 })
		.where(and(eq(cardState.cardPk, cardPk), eq(cardState.ordinal, ordinal)))
		.run();
}

export function setSuspended(x: Executor, cardPk: number, suspended: boolean): void {
	x.update(cards).set({ suspended }).where(eq(cards.pk, cardPk)).run();
}

export interface CardReviewStats {
	tags: string[];
	reviews: number;
	// Reviews graded Hard, Good, or Easy.
	remembered: number;
}

// Per card, how its review-phase reviews since a time went: the reviews that measure retention (learning steps are
// repeated by design, and cram reviews never touch the schedule). Removed cards and decks in the Trash are left out.
export function reviewStatsByCard(
	x: Executor,
	options: { sinceIso: string; deckId?: string }
): CardReviewStats[] {
	return x
		.select({
			tags: cards.tags,
			reviews: count(),
			remembered: sql<number>`coalesce(sum(case when ${reviewLog.grade} >= 2 then 1 else 0 end), 0)`
		})
		.from(reviewLog)
		.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(reviewLog.mode, 'review'),
				eq(reviewLog.prePhase, 2),
				gte(reviewLog.reviewedAt, options.sinceIso),
				eq(cards.archived, false),
				eq(decks.archived, false),
				...(options.deckId === undefined ? [] : [eq(cards.deckId, options.deckId)])
			)
		)
		.groupBy(cards.pk)
		.all();
}
