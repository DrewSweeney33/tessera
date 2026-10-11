import type { Grade } from '#lib/core/scheduler/types.ts';
import { GRADES } from '#lib/core/scheduler/types.ts';
import type { CardType } from '#lib/core/schema/card.ts';
import type { Rng } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import { getDeck, getSettings, type QueueScope } from '../repos/index.ts';
import { countQueue, selectNext, type QueueCategory, type QueueCounts } from './queue.ts';
import { toItemState } from './state.ts';
import { schedulerFor, serializeState, type SerializedState } from './submit.ts';

// What the browser receives for one study item.
export interface StudyItemDto {
	category: QueueCategory;
	cardPk: number;
	ordinal: number;
	deckId: string;
	deckTitle: string;
	key: string;
	type: CardType;
	// Authored fields, as Markdown text. The browser renders and sanitizes them (ADR-005).
	content: Record<string, unknown>;
	tags: string[];
	state: SerializedState;
	// The label for each grade button, such as "10m" or "4d".
	previews: Record<Grade, { label: string }>;
	// Echoed back on submit so a stale answer can be detected.
	servedAt: string;
}

export type NextResponse =
	| { done: false; item: StudyItemDto; counts: QueueCounts }
	| { done: true; waitingUntil: string | null; counts: QueueCounts };

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
			servedAt: context.now.toISOString()
		}
	};
}
