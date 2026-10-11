import { describe, expect, it } from 'vitest';
import { choiceSeed, gradeChoice, positionOfCorrect, shuffleChoices } from '#lib/core/choice.ts';
import { validateDeck } from '#lib/core/schema/deck.ts';

describe('shuffleChoices', () => {
	it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('is a permutation of %i choices', (count) => {
		const order = shuffleChoices(count, 'any seed');
		expect(order).toHaveLength(count);
		expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
	});

	it('gives the same order for the same seed, every time', () => {
		const first = shuffleChoices(6, 'choice:42:0:3');
		for (let i = 0; i < 20; i++) expect(shuffleChoices(6, 'choice:42:0:3')).toEqual(first);
	});

	it('is pinned to known values, so the order cannot change between versions by accident', () => {
		// If these change, every learner's cards would reshuffle mid-session after an upgrade.
		expect(shuffleChoices(4, 'choice:1:0:0')).toEqual(shuffleChoices(4, 'choice:1:0:0'));
		expect(shuffleChoices(5, 'fixed')).toMatchInlineSnapshot(`
			[
			  1,
			  3,
			  0,
			  4,
			  2,
			]
		`);
	});

	it('changes with the seed, and so across reviews of the same item', () => {
		const seen = new Set<string>();
		for (let reps = 0; reps < 40; reps++) {
			seen.add(shuffleChoices(5, choiceSeed(7, 0, reps)).join(','));
		}
		expect(seen.size).toBeGreaterThan(15);
	});

	it('does not favour any position for the first choice (rough check)', () => {
		const counts = [0, 0, 0, 0];
		for (let n = 0; n < 4000; n++) counts[shuffleChoices(4, `seed-${n}`).indexOf(0)]!++;
		// Each position should get about 1000. Allow generous slack, this only catches a broken shuffle.
		for (const count of counts) expect(count).toBeGreaterThan(800);
		for (const count of counts) expect(count).toBeLessThan(1200);
	});

	it('handles a negative count as no choices', () => {
		expect(shuffleChoices(-3, 'x')).toEqual([]);
	});
});

describe('choiceSeed', () => {
	it('is stable for one showing and different across items and reviews', () => {
		expect(choiceSeed(5, 0, 2)).toBe(choiceSeed(5, 0, 2));
		expect(choiceSeed(5, 0, 2)).not.toBe(choiceSeed(5, 0, 3));
		expect(choiceSeed(5, 0, 2)).not.toBe(choiceSeed(6, 0, 2));
		expect(choiceSeed(5, 0, 2)).not.toBe(choiceSeed(5, 1, 2));
	});
});

describe('gradeChoice', () => {
	// Author order: A B C D, correct is C (index 2). Shown as D, B, C, A.
	const order = [3, 1, 2, 0];

	it('grades by what the author marked correct, not by where it is shown', () => {
		expect(gradeChoice(order, 2, 2)).toEqual({ correct: true, suggestedGrade: 3 });
		expect(gradeChoice(order, 2, 0)).toEqual({ correct: false, suggestedGrade: 1 });
		expect(gradeChoice(order, 2, 1)).toEqual({ correct: false, suggestedGrade: 1 });
		expect(gradeChoice(order, 2, 3)).toEqual({ correct: false, suggestedGrade: 1 });
	});

	it('treats a position that does not exist as wrong, without throwing', () => {
		for (const position of [-1, 4, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(gradeChoice(order, 2, position).correct, String(position)).toBe(false);
		}
	});

	it('finds where the right choice is shown', () => {
		expect(positionOfCorrect(order, 2)).toBe(2);
		expect(positionOfCorrect(order, 3)).toBe(0);
		expect(positionOfCorrect(order, 9)).toBe(-1);
	});

	it('exactly one shown position is right for every shuffle', () => {
		for (let n = 0; n < 200; n++) {
			const shuffled = shuffleChoices(6, `s${n}`);
			const right = shuffled.map((_, position) => gradeChoice(shuffled, 4, position).correct);
			expect(right.filter(Boolean)).toHaveLength(1);
			expect(right.indexOf(true)).toBe(positionOfCorrect(shuffled, 4));
		}
	});
});

describe('choice cards in a deck', () => {
	const choice = (extra: Record<string, unknown>) => ({
		tessera: 1,
		deck: { id: 'd', title: 'D' },
		cards: [
			{ id: 'c1', type: 'choice', front: 'Q', choices: ['a', 'b', 'c'], correct: 1, ...extra }
		]
	});
	const errors = (deck: unknown) => {
		const result = validateDeck(deck);
		if (result.ok) throw new Error('expected refusal');
		return result.error.map((e) => [e.path, e.code]);
	};

	it('accepts a valid card at both ends of the range', () => {
		expect(validateDeck(choice({ correct: 0 })).ok).toBe(true);
		expect(validateDeck(choice({ correct: 2 })).ok).toBe(true);
		expect(validateDeck(choice({ choices: ['a', 'b'], correct: 1 })).ok).toBe(true);
		expect(
			validateDeck(choice({ choices: ['1', '2', '3', '4', '5', '6', '7', '8'], correct: 7 })).ok
		).toBe(true);
	});

	it.each([
		['one past the end', { correct: 3 }, [['cards[0].correct', 'out_of_range']]],
		['far out of range', { correct: 99 }, [['cards[0].correct', 'out_of_range']]],
		['negative', { correct: -1 }, [['cards[0].correct', 'too_small']]],
		['fractional', { correct: 1.5 }, [['cards[0].correct', 'wrong_type']]],
		['text instead of a number', { correct: '1' }, [['cards[0].correct', 'wrong_type']]],
		['missing', { correct: undefined }, [['cards[0].correct', 'required']]]
	])('refuses a correct index that is %s', (_name, extra, expected) => {
		expect(errors(choice(extra))).toEqual(expected);
	});

	it.each([
		['the same text twice', ['a', 'b', 'a']],
		['the same text in another case', ['Yes', 'b', 'yes']],
		['the same text with extra space', ['yes', 'b', '  yes  ']]
	])('refuses duplicate choices: %s', (_name, choices) => {
		expect(errors(choice({ choices, correct: 1 }))).toEqual([
			['cards[0].choices[2]', 'duplicate_choice']
		]);
	});

	it('says a fractional index must be a whole number, in words a person can fix', () => {
		const result = validateDeck(choice({ correct: 1.5 }));
		if (result.ok) throw new Error('expected refusal');
		expect(result.error[0]!.message).toBe('correct must be a whole number, but found 1.5');
	});

	it('refuses an empty choice, too few and too many choices', () => {
		expect(errors(choice({ choices: ['a', ''], correct: 0 }))).toEqual([
			['cards[0].choices[1]', 'too_small']
		]);
		expect(errors(choice({ choices: ['a'], correct: 0 }))).toEqual([
			['cards[0].choices', 'too_few']
		]);
		expect(
			errors(choice({ choices: Array.from({ length: 9 }, (_, i) => `c${i}`), correct: 0 }))
		).toEqual([['cards[0].choices', 'too_many']]);
	});

	it('refuses a choice that is too long', () => {
		const long = 'x'.repeat(2001);
		expect(errors(choice({ choices: ['a', long], correct: 0 }))).toEqual([
			['cards[0].choices[1]', 'too_long']
		]);
	});
});
