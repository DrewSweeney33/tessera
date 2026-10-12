import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cardState, cards, type CardStateRow, type NewCardStateRow } from '../db/schema.ts';

export type CardStatePatch = Partial<Omit<NewCardStateRow, 'cardPk' | 'ordinal'>>;

// SQLite limits the number of bound variables in one statement, so large IN lists are chunked.
const CHUNK = 500;

export function insertStates(x: Executor, rows: NewCardStateRow[]): void {
	for (let i = 0; i < rows.length; i += CHUNK) {
		x.insert(cardState)
			.values(rows.slice(i, i + CHUNK))
			.run();
	}
}

export function getState(x: Executor, cardPk: number, ordinal: number): CardStateRow | undefined {
	return x
		.select()
		.from(cardState)
		.where(and(eq(cardState.cardPk, cardPk), eq(cardState.ordinal, ordinal)))
		.get();
}

export function listStatesForCards(x: Executor, cardPks: number[]): CardStateRow[] {
	const out: CardStateRow[] = [];
	for (let i = 0; i < cardPks.length; i += CHUNK) {
		out.push(
			...x
				.select()
				.from(cardState)
				.where(inArray(cardState.cardPk, cardPks.slice(i, i + CHUNK)))
				.all()
		);
	}
	return out;
}

export function listStatesForDeck(x: Executor, deckId: string): CardStateRow[] {
	return x
		.select({ state: cardState })
		.from(cardState)
		.innerJoin(cards, eq(cards.pk, cardState.cardPk))
		.where(eq(cards.deckId, deckId))
		.all()
		.map((row) => row.state);
}

export function updateState(
	x: Executor,
	cardPk: number,
	ordinal: number,
	patch: CardStatePatch
): void {
	x.update(cardState)
		.set(patch)
		.where(and(eq(cardState.cardPk, cardPk), eq(cardState.ordinal, ordinal)))
		.run();
}

// Puts every review item of a deck back to a card that was never studied: due now, no stability, no reps, no
// lapses, not a leech, not buried. The same values a first import gives. Items that were removed from the queue
// stay removed. Returns how many items were reset.
export function resetStatesForDeck(x: Executor, deckId: string, now: string): number {
	return x
		.update(cardState)
		.set({
			due: now,
			stability: 0,
			difficulty: 0,
			elapsedDays: 0,
			scheduledDays: 0,
			learningSteps: 0,
			reps: 0,
			lapses: 0,
			phase: 0,
			lastReview: null,
			leech: false,
			buriedUntil: null
		})
		.where(
			inArray(
				cardState.cardPk,
				x.select({ pk: cards.pk }).from(cards).where(eq(cards.deckId, deckId))
			)
		)
		.run().changes;
}

// Archived items keep their history but leave the study queue.
export function setStatesArchived(
	x: Executor,
	cardPk: number,
	ordinals: number[],
	archived: boolean
): void {
	if (ordinals.length === 0) return;
	x.update(cardState)
		.set({ archived })
		.where(and(eq(cardState.cardPk, cardPk), inArray(cardState.ordinal, ordinals)))
		.run();
}

export function deleteStatesForCard(x: Executor, cardPk: number): void {
	x.delete(cardState).where(eq(cardState.cardPk, cardPk)).run();
}
