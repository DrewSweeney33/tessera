import type { StudyItemDto } from '#lib/core/api-types.ts';
import { choiceSeed, gradeChoice, positionOfCorrect, shuffleChoices } from '#lib/core/choice.ts';
import { matchTyped } from '#lib/core/typed-match.ts';

// What the study screen needs to run a typed or multiple choice card: the pieces of the card, and the
// result of the learner's attempt. The matching and grading rules are in core. This only wires them to a
// study item. The result is a suggestion: the learner always picks the grade.

export type SuggestedGrade = 1 | 3;

export interface Outcome {
	// True when the typed answer matched, or the right choice was picked.
	correct: boolean;
	suggestedGrade: SuggestedGrade;
	// One plain sentence for the result, for example "Your answer matches."
	summary: string;
	// What the learner typed, trimmed. Undefined for other card types or when nothing was typed.
	typed: string | undefined;
	// The position of the chosen option on screen. Undefined when none was chosen.
	position: number | undefined;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

// The text of the typed card's question's answer and the other accepted answers.
export function typedAnswers(item: Pick<StudyItemDto, 'content'>): {
	answer: string;
	accept: string[];
} {
	return { answer: text(item.content['answer']), accept: strings(item.content['accept']) };
}

export function checkTyped(item: Pick<StudyItemDto, 'content'>, input: string): Outcome {
	const { answer, accept } = typedAnswers(item);
	const typed = input.trim();
	const result = matchTyped(typed, answer, accept);
	return {
		correct: result.correct,
		suggestedGrade: result.suggestedGrade,
		summary: result.correct
			? 'Your answer matches.'
			: typed === ''
				? 'You did not type an answer.'
				: 'Your answer does not match.',
		typed: typed === '' ? undefined : typed,
		position: undefined
	};
}

export interface ChoiceView {
	// The author's choices in the order shown. The shuffle is the same for the same card and review count.
	shown: { text: string; original: number }[];
	// Where the right choice is on screen.
	correctPosition: number;
	explanation: string | undefined;
	order: number[];
	correct: number;
}

export function choiceView(
	item: Pick<StudyItemDto, 'content' | 'cardPk' | 'ordinal' | 'state'>
): ChoiceView {
	const choices = strings(item.content['choices']);
	const correct = typeof item.content['correct'] === 'number' ? item.content['correct'] : -1;
	const order = shuffleChoices(
		choices.length,
		choiceSeed(item.cardPk, item.ordinal, item.state.reps)
	);
	return {
		shown: order.map((original) => ({ text: choices[original] ?? '', original })),
		correctPosition: positionOfCorrect(order, correct),
		explanation: text(item.content['explanation']) || undefined,
		order,
		correct
	};
}

// `position` is undefined when the learner chose to see the answer without choosing.
export function checkChoice(view: ChoiceView, position: number | undefined): Outcome {
	if (position === undefined) {
		return {
			correct: false,
			suggestedGrade: 1,
			summary: 'You did not choose an answer.',
			typed: undefined,
			position: undefined
		};
	}
	const result = gradeChoice(view.order, view.correct, position);
	return {
		correct: result.correct,
		suggestedGrade: result.suggestedGrade,
		summary: result.correct ? 'Correct.' : 'Not quite.',
		typed: undefined,
		position
	};
}
