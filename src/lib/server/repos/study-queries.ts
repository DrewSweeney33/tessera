import { and, asc, count, eq, gte, inArray, isNull, lte, min, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import {
	cardState,
	cards,
	decks,
	reviewLog,
	type CardRow,
	type CardStateRow,
	type DeckRow
} from '../db/schema.ts';

// SQL for the study queue. All filtering and ordering lives here so the selection rules in
// server/study can be read without any query details (ADR-003).

export interface QueueRow {
	state: CardStateRow;
	card: CardRow;
}

export interface QueueScope {
	// Undefined means every deck.
	deckId?: string | undefined;
	// Limits the queue to the decks in one folder. Undefined means no folder limit.
	folderId?: number | undefined;
	// Limits it to the cards that carry this tag, in any deck (card tags, matched exactly as stored). Only Practice
	// uses it (ADR-020); the study queue never sets it.
	tag?: string | undefined;
}

// Items that are not removed or set aside: archived or suspended cards, archived decks, archived review items,
// limited to the scope. Practice (ADR-017) uses exactly these.
function active(scope: QueueScope): SQL[] {
	const conditions: SQL[] = [
		eq(cardState.archived, false),
		eq(cards.archived, false),
		eq(cards.suspended, false),
		eq(decks.archived, false)
	];
	if (scope.deckId !== undefined) conditions.push(eq(cards.deckId, scope.deckId));
	if (scope.folderId !== undefined) conditions.push(eq(decks.folderId, scope.folderId));
	if (scope.tag !== undefined) {
		conditions.push(
			sql`exists (select 1 from json_each(${cards.tags}) where json_each.value = ${scope.tag})`
		);
	}
	return conditions;
}

// Items that may never be shown right now: the active items without the ones buried until later.
function eligible(nowIso: string, scope: QueueScope): SQL[] {
	return [...active(scope), or(isNull(cardState.buriedUntil), lte(cardState.buriedUntil, nowIso))!];
}

// The basic and typed cards that can supply wrong options for a quiz question (ADR-020): active cards only, in a deck
// (`deckId`) or in every other deck (`excludeDeckId`), without the card being asked about. A bounded, ordered read.
export function listQuizSources(
	x: Executor,
	args: { deckId?: string; excludeDeckId?: string; excludeCardPk?: number; limit: number }
): CardRow[] {
	const conditions: SQL[] = [
		inArray(cards.type, ['basic', 'typed']),
		eq(cards.archived, false),
		eq(cards.suspended, false),
		eq(decks.archived, false)
	];
	if (args.deckId !== undefined) conditions.push(eq(cards.deckId, args.deckId));
	if (args.excludeDeckId !== undefined) conditions.push(ne(cards.deckId, args.excludeDeckId));
	if (args.excludeCardPk !== undefined) conditions.push(ne(cards.pk, args.excludeCardPk));
	return x
		.select({ card: cards })
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...conditions))
		.orderBy(asc(cards.pk))
		.limit(args.limit)
		.all()
		.map((row) => row.card);
}

// Everything in the scope that practice may show: whatever its due date and whether or not it is buried.
export function listPracticePool(x: Executor, scope: QueueScope): QueueRow[] {
	return selectRows(x)
		.where(and(...active(scope)))
		.orderBy(asc(cardState.cardPk), asc(cardState.ordinal))
		.all();
}

function selectRows(x: Executor) {
	return x
		.select({ state: cardState, card: cards })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId));
}

// Learning and relearning items due at or before `untilIso`, earliest first.
export function listLearning(
	x: Executor,
	args: { nowIso: string; untilIso: string; scope: QueueScope; limit: number }
): QueueRow[] {
	return selectRows(x)
		.where(
			and(
				...eligible(args.nowIso, args.scope),
				inArray(cardState.phase, [1, 3]),
				lte(cardState.due, args.untilIso)
			)
		)
		.orderBy(asc(cardState.due), asc(cardState.cardPk), asc(cardState.ordinal))
		.limit(args.limit)
		.all();
}

// Review items due at or before the end of the study day, earliest first.
export function listReviewDue(
	x: Executor,
	args: { nowIso: string; dueBeforeIso: string; scope: QueueScope; limit: number }
): QueueRow[] {
	return selectRows(x)
		.where(
			and(
				...eligible(args.nowIso, args.scope),
				eq(cardState.phase, 2),
				lte(cardState.due, args.dueBeforeIso)
			)
		)
		.orderBy(asc(cardState.due), asc(cardState.cardPk), asc(cardState.ordinal))
		.limit(args.limit)
		.all();
}

// New items in the given decks, in deck title then file order.
export function listNew(
	x: Executor,
	args: { nowIso: string; deckIds: string[]; limit: number }
): QueueRow[] {
	if (args.deckIds.length === 0) return [];
	return selectRows(x)
		.where(
			and(...eligible(args.nowIso, {}), eq(cardState.phase, 0), inArray(cards.deckId, args.deckIds))
		)
		.orderBy(asc(decks.title), asc(cards.position), asc(cardState.ordinal))
		.limit(args.limit)
		.all();
}

// The earliest due time of a learning item between two instants, for "next card in 12 minutes".
export function nextLearningDue(
	x: Executor,
	args: { nowIso: string; afterIso: string; beforeIso: string; scope: QueueScope }
): string | undefined {
	const row = x
		.select({ due: min(cardState.due) })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				...eligible(args.nowIso, args.scope),
				inArray(cardState.phase, [1, 3]),
				gte(cardState.due, args.afterIso),
				lte(cardState.due, args.beforeIso)
			)
		)
		.get();
	return row?.due ?? undefined;
}

// Active decks in scope with their per-deck new card limit override.
export function listDecksInScope(x: Executor, scope: QueueScope): DeckRow[] {
	const conditions = [eq(decks.archived, false)];
	if (scope.deckId !== undefined) conditions.push(eq(decks.id, scope.deckId));
	if (scope.folderId !== undefined) conditions.push(eq(decks.folderId, scope.folderId));
	return x
		.select()
		.from(decks)
		.where(and(...conditions))
		.orderBy(asc(decks.title))
		.all();
}

// New items first reviewed since `sinceIso`, per deck. A card counts once, on its first review.
export function countNewIntroducedSince(x: Executor, sinceIso: string): Map<string, number> {
	const rows = x
		.select({ deckId: cards.deckId, total: count() })
		.from(reviewLog)
		.innerJoin(cards, eq(cards.pk, reviewLog.cardPk))
		.where(
			and(
				eq(reviewLog.mode, 'review'),
				eq(reviewLog.prePhase, 0),
				gte(reviewLog.reviewedAt, sinceIso)
			)
		)
		.groupBy(cards.deckId)
		.all();
	return new Map(rows.map((row) => [row.deckId, row.total]));
}

// Reviews of graduated cards done since `sinceIso`. Learning steps do not count toward the daily limit.
export function countReviewsSince(x: Executor, sinceIso: string): number {
	return (
		x
			.select({ total: count() })
			.from(reviewLog)
			.where(
				and(
					eq(reviewLog.mode, 'review'),
					eq(reviewLog.prePhase, 2),
					gte(reviewLog.reviewedAt, sinceIso)
				)
			)
			.get()?.total ?? 0
	);
}

// Counts of available items, with the same filters as the lists above.
export function countByPhase(
	x: Executor,
	args: { nowIso: string; scope: QueueScope; phases: number[]; dueBeforeIso?: string }
): Map<string, number> {
	const conditions = [...eligible(args.nowIso, args.scope), inArray(cardState.phase, args.phases)];
	if (args.dueBeforeIso !== undefined) conditions.push(lte(cardState.due, args.dueBeforeIso));
	const rows = x
		.select({ deckId: cards.deckId, total: count() })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...conditions))
		.groupBy(cards.deckId)
		.all();
	return new Map(rows.map((row) => [row.deckId, row.total]));
}
