import type { NextResponse, StudyItemDto } from '#lib/core/api-types.ts';
import type { Grade } from '#lib/core/scheduler/types.ts';
import { GRADES } from '#lib/core/scheduler/types.ts';
import type { Rng } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import { getDeck, getSettings, type QueueScope } from '../repos/index.ts';
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
	const deck = getDeck(x, card.deckId);
	const scheduler = schedulerFor(deck?.targetRetention ?? getSettings(x).targetRetention);
	const preview = scheduler.preview(toItemState(state), context.now);
	const previews = {} as Record<Grade, { label: string }>;
	for (const grade of GRADES) previews[grade] = { label: preview[grade].label };

	// The system clock can step backwards (an NTP correction, a VM resuming). An item must never be
	// stamped earlier than its own last review, or the stale check in submitReview would reject every
	// answer until the clock caught up. Genuine races between tabs are still caught, because the other
	// tab's review is later than this stamp.
	const nowIso = context.now.toISOString();
	const servedAt =
		state.lastReview !== null && state.lastReview > nowIso ? state.lastReview : nowIso;

	return {
		done: false,
		counts,
		item: {
			category,
			cardPk: card.pk,
			ordinal: state.ordinal,
			deckId: card.deckId,
			deckTitle: deck?.title ?? card.deckId,
			key: card.key,
			type: card.type,
			content: card.content,
			tags: card.tags,
			state: serializeState(toItemState(state)),
			previews,
			servedAt
		}
	};
}
