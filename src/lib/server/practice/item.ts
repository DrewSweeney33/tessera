import type { PracticeItemDto } from '#lib/core/api-types.ts';
import { buildQuiz, quizAnswerOf } from '#lib/core/quiz.ts';
import { toItemState, serializeState } from '../study/state.ts';
import type { Executor } from '../db/client.ts';
import { getCard, getDeck, getState, listQuizSources } from '../repos/index.ts';

// How many other cards are read for wrong options: enough to choose from, bounded so one question is one small read.
const SOURCE_LIMIT = 300;

// One item for practice, shaped like a study item without the schedule parts. Refuses what practice may not
// show: a removed or suspended card, a removed item, or a deck in the Trash. With a quiz seed (ADR-020), a basic or
// typed card that can be made into a question comes back as a choice card: its own answer and three wrong ones from
// other cards, the same for the same seed. A card that cannot be quizzed comes back as it is.
export function getPracticeItem(
	x: Executor,
	cardPk: number,
	ordinal: number,
	options: { quizSeed?: string } = {}
): PracticeItemDto | undefined {
	const card = getCard(x, cardPk);
	const state = getState(x, cardPk, ordinal);
	if (!card || !state || card.archived || card.suspended || state.archived) return undefined;
	const deck = getDeck(x, card.deckId);
	if (!deck || deck.archived) return undefined;
	const item: PracticeItemDto = {
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
	if (options.quizSeed === undefined) return item;

	const correct = quizAnswerOf(card);
	const front = card.content['front'];
	if (correct === undefined || typeof front !== 'string') return item;
	const answersOf = (rows: ReturnType<typeof listQuizSources>) =>
		rows.flatMap((row) => quizAnswerOf(row) ?? []);
	const question = buildQuiz({
		correct,
		sameDeck: answersOf(
			listQuizSources(x, { deckId: card.deckId, excludeCardPk: card.pk, limit: SOURCE_LIMIT })
		),
		others: answersOf(listQuizSources(x, { excludeDeckId: card.deckId, limit: SOURCE_LIMIT })),
		seed: `${options.quizSeed}:${card.pk}:${state.ordinal}`
	});
	if (!question) return item;
	return {
		...item,
		type: 'choice',
		content: { front, choices: question.options, correct: question.correctIndex },
		quiz: true
	};
}
