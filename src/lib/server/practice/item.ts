import type { PracticeItemDto } from '#lib/core/api-types.ts';
import { toItemState, serializeState } from '../study/state.ts';
import type { Executor } from '../db/client.ts';
import { getCard, getDeck, getState } from '../repos/index.ts';

// One item for practice, shaped like a study item without the schedule parts. Refuses what practice may not
// show: a removed or suspended card, a removed item, or a deck in the Trash.
export function getPracticeItem(
	x: Executor,
	cardPk: number,
	ordinal: number
): PracticeItemDto | undefined {
	const card = getCard(x, cardPk);
	const state = getState(x, cardPk, ordinal);
	if (!card || !state || card.archived || card.suspended || state.archived) return undefined;
	const deck = getDeck(x, card.deckId);
	if (!deck || deck.archived) return undefined;
	return {
		cardPk: card.pk,
		ordinal: state.ordinal,
		deckId: card.deckId,
		deckTitle: deck.title,
		key: card.key,
		type: card.type,
		content: card.content,
		tags: card.tags,
		state: serializeState(toItemState(state))
	};
}
