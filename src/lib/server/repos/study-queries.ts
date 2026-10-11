import { and, asc, count, eq, gte, inArray, isNull, lte, min, or } from 'drizzle-orm';
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
}

// Items that may never be shown right now: archived or suspended cards, archived decks,
// archived review items, and siblings buried until later.
function eligible(nowIso: string, scope: QueueScope): SQL[] {
	const conditions: SQL[] = [
		eq(cardState.archived, false),
		eq(cards.archived, false),
		eq(cards.suspended, false),
		eq(decks.archived, false),
		or(isNull(cardState.buriedUntil), lte(cardState.buriedUntil, nowIso))!
	];
	if (scope.deckId !== undefined) conditions.push(eq(cards.deckId, scope.deckId));
	return conditions;
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
	const query = x.select().from(decks);
	const active = eq(decks.archived, false);
	return (
		scope.deckId === undefined
			? query.where(active)
			: query.where(and(active, eq(decks.id, scope.deckId)))
	)
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
