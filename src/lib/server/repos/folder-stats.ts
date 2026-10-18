import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cardState, cards, decks, reviewLog } from '../db/schema.ts';
import type { QueueScope } from './study-queries.ts';

// Queries behind the statistics of a scope: every deck, one deck, or the decks in one folder (the folder statistics
// and the Statistics page share them). Every one leaves out decks in the Trash. Counts are review items (a cloze
// card has one per blank), like every other count in the app. Study numbers read `mode = 'review'` rows only, so
// practice answers (`mode = 'cram'`) are never in them.

// Decks that are not in the Trash, limited to the scope.
function inScope(scope: QueueScope): SQL[] {
	return [
		eq(decks.archived, false),
		...(scope.deckId === undefined ? [] : [eq(decks.id, scope.deckId)]),
		...(scope.folderId === undefined ? [] : [eq(decks.folderId, scope.folderId)])
	];
}

export interface FolderItemCounts {
	new: number;
	learning: number;
	review: number;
	suspended: number;
}

// Review items in the scope by where they are in learning. Removed cards, removed blanks, and the Trash are left
// out. Items of suspended cards are counted apart, so the other three match what a study session could serve.
export function countScopeItems(x: Executor, scope: QueueScope): FolderItemCounts {
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
		.where(and(...inScope(scope), eq(cards.archived, false), eq(cardState.archived, false)))
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

// Active cards and decks in the scope.
export function countScopeCards(x: Executor, scope: QueueScope): { decks: number; cards: number } {
	const row = x
		.select({
			decks: sql<number>`count(distinct ${decks.id})`,
			cards: sql<number>`count(*)`
		})
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...inScope(scope), eq(cards.archived, false)))
		.get();
	return { decks: row?.decks ?? 0, cards: row?.cards ?? 0 };
}

export interface ReviewWindowTotals {
	reviews: number;
	timeMs: number;
	// Review-phase reviews (the ones that measure retention) and how many of them were graded Hard, Good, or Easy.
	retentionReviews: number;
	retentionRemembered: number;
}

// What the reviews since a time add up to for a scope. `mode = 'review'` only: practice reviews never touch the
// schedule and are not study progress.
export function reviewTotalsSince(
	x: Executor,
	scope: QueueScope,
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
			and(...inScope(scope), eq(reviewLog.mode, 'review'), gte(reviewLog.reviewedAt, sinceIso))
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

// Every review of a scope since a time, oldest first, for the per-day numbers, the streak, and the heatmap.
export function listReviewPointsSince(
	x: Executor,
	scope: QueueScope,
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
			and(...inScope(scope), eq(reviewLog.mode, 'review'), gte(reviewLog.reviewedAt, sinceIso))
		)
		.orderBy(reviewLog.reviewedAt)
		.all();
}

export interface PracticeTotals {
	// Different items practiced, and answers given (an item looped back counts once as an item, each time as an answer).
	items: number;
	answers: number;
	timeMs: number;
}

// Practice again answers (`mode = 'cram'`) since a time. They are shown apart and never added to a study number.
export function practiceTotalsSince(
	x: Executor,
	scope: QueueScope,
	sinceIso: string
): PracticeTotals {
	const row = x
		.select({
			items: sql<number>`count(distinct ${reviewLog.cardPk} * 100 + ${reviewLog.ordinal})`,
			answers: sql<number>`count(*)`,
			timeMs: sql<number>`coalesce(sum(coalesce(${reviewLog.durationMs}, 0)), 0)`
		})
		.from(reviewLog)
		.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...inScope(scope), eq(reviewLog.mode, 'cram'), gte(reviewLog.reviewedAt, sinceIso)))
		.get();
	return { items: row?.items ?? 0, answers: row?.answers ?? 0, timeMs: row?.timeMs ?? 0 };
}

export interface DueRow {
	due: string;
	phase: number;
}

// When the scheduled items fall due, up to a time: learning, review, and relearning items that a session could serve
// (not removed, not suspended). New items have no due time worth forecasting and are left out.
export function listDueUntil(x: Executor, scope: QueueScope, untilIso: string): DueRow[] {
	return x
		.select({ due: cardState.due, phase: cardState.phase })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				...inScope(scope),
				eq(cards.archived, false),
				eq(cards.suspended, false),
				eq(cardState.archived, false),
				inArray(cardState.phase, [1, 2, 3]),
				lte(cardState.due, untilIso)
			)
		)
		.all();
}
