import { describe, expect, it } from 'vitest';
import { checkChoice, checkTyped, choiceView, typedAnswers } from '#lib/ui/study-card.ts';

const state = (reps: number) =>
	({
		due: '2026-10-11T00:00:00.000Z',
		stability: 0,
		difficulty: 0,
		elapsedDays: 0,
		scheduledDays: 0,
		learningSteps: 0,
		reps,
		lapses: 0,
		phase: 0,
		lastReview: null
	}) as const;

const typedItem = {
	content: { answer: 'show ip ospf neighbor', accept: ['sh ip ospf nei', 'show ip ospf neighbour'] }
};

const choiceItem = (reps = 0, extra: Record<string, unknown> = {}) => ({
	cardPk: 7,
	ordinal: 0,
	state: state(reps),
	content: {
		front: 'Which LSA type describes a network segment?',
		choices: ['Type 1', 'Type 2', 'Type 3', 'Type 5'],
		correct: 1,
		...extra
	}
});

describe('typed answers', () => {
	it('reads the answer and the accepted alternatives from the card', () => {
		expect(typedAnswers(typedItem)).toEqual({
			answer: 'show ip ospf neighbor',
			accept: ['sh ip ospf nei', 'show ip ospf neighbour']
		});
		expect(typedAnswers({ content: {} })).toEqual({ answer: '', accept: [] });
		expect(typedAnswers({ content: { answer: 5, accept: 'nope' } })).toEqual({
			answer: '',
			accept: []
		});
	});

	it('suggests Good for a match, ignoring case, spacing, and a final full stop', () => {
		for (const input of [
			'show ip ospf neighbor',
			'  SHOW   IP OSPF NEIGHBOR. ',
			'sh ip ospf nei'
		]) {
			const outcome = checkTyped(typedItem, input);
			expect(outcome, input).toMatchObject({ correct: true, suggestedGrade: 3 });
			expect(outcome.summary).toBe('Your answer matches.');
		}
	});

	it('suggests Again for a wrong answer and keeps what was typed, trimmed', () => {
		const outcome = checkTyped(typedItem, '  show ip route ');
		expect(outcome).toMatchObject({
			correct: false,
			suggestedGrade: 1,
			summary: 'Your answer does not match.',
			typed: 'show ip route',
			position: undefined
		});
	});

	it('says so when nothing was typed, and records no answer', () => {
		for (const input of ['', '   ', '\n']) {
			expect(checkTyped(typedItem, input)).toMatchObject({
				correct: false,
				suggestedGrade: 1,
				summary: 'You did not type an answer.',
				typed: undefined
			});
		}
	});

	it('does not treat a different value as a match', () => {
		const ip = { content: { answer: '10.0.0.1' } };
		expect(checkTyped(ip, '10001').correct).toBe(false);
		expect(checkTyped(ip, '10.0.0.1').correct).toBe(true);
	});
});

describe('choice cards', () => {
	it('shows every choice once, and says where the right one is', () => {
		const view = choiceView(choiceItem());
		expect(view.shown.map((c) => c.text).sort()).toEqual(['Type 1', 'Type 2', 'Type 3', 'Type 5']);
		expect(view.shown[view.correctPosition]).toEqual({ text: 'Type 2', original: 1 });
		expect(view.order).toHaveLength(4);
	});

	it('keeps what is shown in step with the order used for grading, for every review count', () => {
		let shuffled = 0;
		for (let reps = 0; reps < 30; reps++) {
			const view = choiceView(choiceItem(reps));
			expect(
				view.shown.map((c) => c.original),
				`reps ${reps}`
			).toEqual(view.order);
			expect(view.shown[view.correctPosition]).toEqual({ text: 'Type 2', original: 1 });
			if (view.order.join() !== '0,1,2,3') shuffled++;
		}
		expect(shuffled, 'the shuffle actually moves options').toBeGreaterThan(20);
	});

	it('shows the same order for the same card and review count, so a refresh does not move options', () => {
		expect(choiceView(choiceItem(3)).order).toEqual(choiceView(choiceItem(3)).order);
	});

	it('can show a different order after another review', () => {
		const orders = new Set(
			Array.from({ length: 12 }, (_, reps) => choiceView(choiceItem(reps)).order.join(','))
		);
		expect(orders.size).toBeGreaterThan(1);
	});

	it('carries the explanation when there is one', () => {
		expect(choiceView(choiceItem(0, { explanation: 'The DR makes it.' })).explanation).toBe(
			'The DR makes it.'
		);
		expect(choiceView(choiceItem()).explanation).toBeUndefined();
	});

	it('grades the position the learner picked by the author correct index, wherever it is shown', () => {
		for (let reps = 0; reps < 10; reps++) {
			const view = choiceView(choiceItem(reps));
			for (let position = 0; position < 4; position++) {
				const outcome = checkChoice(view, position);
				const right = position === view.correctPosition;
				expect(outcome, `reps ${reps} position ${position}`).toMatchObject({
					correct: right,
					suggestedGrade: right ? 3 : 1,
					position,
					typed: undefined
				});
				expect(outcome.summary).toBe(right ? 'Correct.' : 'Not quite.');
			}
		}
	});

	it('suggests Again when the learner chose not to answer', () => {
		expect(checkChoice(choiceView(choiceItem()), undefined)).toMatchObject({
			correct: false,
			suggestedGrade: 1,
			summary: 'You did not choose an answer.',
			position: undefined
		});
	});

	it('does not crash on malformed stored content', () => {
		const view = choiceView({ cardPk: 1, ordinal: 0, state: state(0), content: {} });
		expect(view.shown).toEqual([]);
		expect(view.correctPosition).toBe(-1);
		expect(checkChoice(view, 0).correct).toBe(false);
	});
});
