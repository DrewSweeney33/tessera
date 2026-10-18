import type { NextResponse, QueueCategory, StudyItemDto } from '#lib/core/api-types.ts';
import { GRADES, type Grade } from '#lib/core/scheduler/types.ts';
import type { Rng } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import type { CardRow, CardStateRow } from '../db/schema.ts';
import { getCard, getDeck, getSettings, getState, type QueueScope } from '../repos/index.ts';
import { countQueue, selectNext } from './queue.ts';
import { toItemState } from './state.ts';
import { schedulerFor, serializeState } from './submit.ts';

// The response shapes live in core/api-types.ts so the browser shares them.
export type { NextResponse, StudyItemDto };

export interface NextContext {
	scope: QueueScope;
	now: Date;
	timeZone: string;
	rng: Rng;
}

// The queue category of an item, from its phase: never studied is new, learning and relearning are learning, and a
// card in review is review. The same split selectNext uses.
export function categoryOf(phase: number): QueueCategory {
	if (phase === 0) return 'new';
	if (phase === 2) return 'review';
	return 'learning';
}

// Shapes one item for the client: the card, its state, and the label of each grade button.
export function buildItemDto(
	x: Executor,
	now: Date,
	category: QueueCategory,
	card: CardRow,
	state: CardStateRow
): StudyItemDto {
	const deck = getDeck(x, card.deckId);
	const scheduler = schedulerFor(deck?.targetRetention ?? getSettings(x).targetRetention);
	const itemState = toItemState(state);
	const preview = scheduler.preview(itemState, now);
	const previews = {} as Record<Grade, { label: string }>;
	for (const grade of GRADES) previews[grade] = { label: preview[grade].label };

	// The system clock can step backwards (an NTP correction, a VM resuming). An item must never be
	// stamped earlier than its own last review, or the stale check in submitReview would reject every
	// answer until the clock caught up. Genuine races between tabs are still caught, because the other
	// tab's review is later than this stamp.
	const nowIso = now.toISOString();
	const servedAt =
		state.lastReview !== null && state.lastReview > nowIso ? state.lastReview : nowIso;

	return {
		category,
		cardPk: card.pk,
		ordinal: state.ordinal,
		deckId: card.deckId,
		deckTitle: deck?.title ?? card.deckId,
		key: card.key,
		type: card.type,
		content: card.content,
		tags: card.tags,
		state: serializeState(itemState),
		previews,
		servedAt
	};
}

// Picks the next item and shapes it for the client, with grade previews and the current counts.
export function buildNext(x: Executor, context: NextContext): NextResponse {
	const counts = countQueue(x, {
		scope: context.scope,
		now: context.now,
		timeZone: context.timeZone
	});
	const result = selectNext(x, context);
	if (result.kind === 'empty') {
		return {
			done: true,
			waitingUntil: result.waitingUntil ? result.waitingUntil.toISOString() : null,
			counts
		};
	}
	const { card, state, category } = result.item;
	return { done: false, counts, item: buildItemDto(x, context.now, category, card, state) };
}

// The item an undo puts back on the screen: the card that was just un-answered, in the state it had before the
// answer, with the counts as they are now.
export function buildItemFor(
	x: Executor,
	context: Omit<NextContext, 'rng'>,
	cardPk: number,
	ordinal: number
): NextResponse | undefined {
	const card = getCard(x, cardPk);
	const state = getState(x, cardPk, ordinal);
	if (!card || !state) return undefined;
	const counts = countQueue(x, {
		scope: context.scope,
		now: context.now,
		timeZone: context.timeZone
	});
	return {
		done: false,
		counts,
		item: buildItemDto(x, context.now, categoryOf(state.phase), card, state)
	};
}
