import { and, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cardState, cards, decks, reviewLog } from '../db/schema.ts';

// Queries behind a folder's statistics. Every one is limited to the decks that are in the folder and not in the
// Trash. Counts are review items (a cloze card has one per blank), like every other count in the app.

export interface FolderItemCounts {
	new: number;
	learning: number;
	review: number;
	suspended: number;
}

// Review items in the folder by where they are in learning. Removed cards, removed blanks, and the Trash are left
// out. Items of suspended cards are counted apart, so the other three match what a study session could serve.
export function countFolderItems(x: Executor, folderId: number): FolderItemCounts {
	const row = x
		.select({
			newItems: sql<number>`coalesce(sum(case when ${cards.suspended} = 0 and ${cardState.phase} = 0 then 1 else 0 end), 0)`,
			learning: sql<number>`coalesce(sum(case when ${cards.suspended} = 0 and ${cardState.phase} in (1, 3) then 1 else 0 end), 0)`,
			review: sql<number>`coalesce(sum(case when ${cards.suspended} = 0 and ${cardState.phase} = 2 then 1 else 0 end), 0)`,
			suspended: sql<number>`coalesce(sum(case when ${cards.suspended} = 1 then 1 else 0 end), 0)`
		})
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(decks.folderId, folderId),
				eq(decks.archived, false),
				eq(cards.archived, false),
				eq(cardState.archived, false)
			)
		)
		.get();
	return {
		new: row?.newItems ?? 0,
		learning: row?.learning ?? 0,
		review: row?.review ?? 0,
		suspended: row?.suspended ?? 0
	};
}

// Active cards (not removed) in each folder's decks.
export function countFolderCards(x: Executor): Map<number, number> {
	const rows = x
		.select({ folderId: decks.folderId, total: sql<number>`count(*)` })
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(eq(cards.archived, false), eq(decks.archived, false)))
		.groupBy(decks.folderId)
		.all();
	const out = new Map<number, number>();
	for (const row of rows) if (row.folderId !== null) out.set(row.folderId, row.total);
	return out;
}

export interface ReviewWindowTotals {
	reviews: number;
	timeMs: number;
	// Review-phase reviews (the ones that measure retention) and how many of them were graded Hard, Good, or Easy.
	retentionReviews: number;
	retentionRemembered: number;
}

// What the reviews since a time add up to for one folder. `mode = 'review'` only: practice reviews never touch the
// schedule and are not study progress.
export function reviewTotalsSince(
	x: Executor,
	folderId: number,
	sinceIso: string
): ReviewWindowTotals {
	const row = x
		.select({
			reviews: sql<number>`count(*)`,
			timeMs: sql<number>`coalesce(sum(coalesce(${reviewLog.durationMs}, 0)), 0)`,
			retentionReviews: sql<number>`coalesce(sum(case when ${reviewLog.prePhase} = 2 then 1 else 0 end), 0)`,
			retentionRemembered: sql<number>`coalesce(sum(case when ${reviewLog.prePhase} = 2 and ${reviewLog.grade} >= 2 then 1 else 0 end), 0)`
		})
		.from(reviewLog)
		.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(decks.folderId, folderId),
				eq(decks.archived, false),
				eq(reviewLog.mode, 'review'),
				gte(reviewLog.reviewedAt, sinceIso)
			)
		)
		.get();
	return {
		reviews: row?.reviews ?? 0,
		timeMs: row?.timeMs ?? 0,
		retentionReviews: row?.retentionReviews ?? 0,
		retentionRemembered: row?.retentionRemembered ?? 0
	};
}

export interface ReviewPointRow {
	reviewedAt: string;
	grade: number;
	durationMs: number | null;
}

// Every review of one folder since a time, oldest first, for the per-day numbers and the streak.
export function listReviewPointsSince(
	x: Executor,
	folderId: number,
	sinceIso: string
): ReviewPointRow[] {
	return x
		.select({
			reviewedAt: reviewLog.reviewedAt,
			grade: reviewLog.grade,
			durationMs: reviewLog.durationMs
		})
		.from(reviewLog)
		.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(decks.folderId, folderId),
				eq(decks.archived, false),
				eq(reviewLog.mode, 'review'),
				gte(reviewLog.reviewedAt, sinceIso)
			)
		)
		.orderBy(reviewLog.reviewedAt)
		.all();
}
