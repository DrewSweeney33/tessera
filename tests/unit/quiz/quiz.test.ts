import { describe, expect, it } from 'vitest';
import {
	MAX_ANSWER_LENGTH,
	WRONG_OPTIONS,
	answerKey,
	buildQuiz,
	quizAnswerOf,
	seededRandom,
	seededShuffle,
	usableAnswer
} from '#lib/core/quiz.ts';

// Quiz me (ADR-020): the pure rules. The properties that matter: the right answer is in the question exactly once,
// no wrong option is the right answer or another option, the same seed always gives the same question, and a card
// that cannot be quizzed says so instead of showing a question with fewer options.

describe('quizAnswerOf', () => {
	it('is the back of a basic card and the answer of a typed card, and nothing for other types', () => {
		expect(quizAnswerOf({ type: 'basic', content: { front: 'Q', back: 'A' } })).toBe('A');
		expect(
			quizAnswerOf({ type: 'typed', content: { front: 'Q', answer: 'abc', accept: ['x'] } })
		).toBe('abc');
		expect(quizAnswerOf({ type: 'cloze', content: { text: 'The {{c1::sky}}' } })).toBeUndefined();
		expect(
			quizAnswerOf({ type: 'choice', content: { front: 'Q', choices: ['a', 'b'], correct: 0 } })
		).toBeUndefined();
		expect(quizAnswerOf({ type: 'basic', content: { front: 'Q' } })).toBeUndefined();
		expect(quizAnswerOf({ type: 'basic', content: { front: 'Q', back: 5 } })).toBeUndefined();
	});
});

describe('usableAnswer', () => {
	it('accepts one short line, and trims before it measures', () => {
		expect(usableAnswer('OSPF')).toBe(true);
		expect(usableAnswer('  padded  ')).toBe(true);
		expect(usableAnswer('x'.repeat(MAX_ANSWER_LENGTH))).toBe(true);
		expect(usableAnswer(` ${'x'.repeat(MAX_ANSWER_LENGTH)} `)).toBe(true);
	});

	it('refuses empty, blank, long, multi-line, and non-text answers', () => {
		for (const value of [
			'',
			'   ',
			'x'.repeat(MAX_ANSWER_LENGTH + 1),
			'one\ntwo',
			'one\r\ntwo',
			undefined,
			null,
			5,
			['a']
		]) {
			expect(usableAnswer(value), JSON.stringify(value)).toBe(false);
		}
	});
});

describe('answerKey', () => {
	it('ignores case, outer space, and runs of spaces', () => {
		expect(answerKey('  Show   IP Route ')).toBe('show ip route');
		expect(answerKey('Ospf')).toBe(answerKey('oSPF'));
	});
});

describe('seededRandom and seededShuffle', () => {
	it('gives the same numbers for the same seed, in [0, 1), and different ones for another seed', () => {
		const a = seededRandom('seed-one');
		const b = seededRandom('seed-one');
		const first = Array.from({ length: 20 }, () => a());
		expect(Array.from({ length: 20 }, () => b())).toEqual(first);
		expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
		const c = seededRandom('seed-two');
		expect(Array.from({ length: 20 }, () => c())).not.toEqual(first);
	});

	it('shuffles into a permutation without changing the original, the same way for the same seed', () => {
		const items = ['a', 'b', 'c', 'd', 'e', 'f'];
		const once = seededShuffle(items, seededRandom('x'));
		expect([...once].sort()).toEqual(items);
		expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
		expect(seededShuffle(items, seededRandom('x'))).toEqual(once);
		expect(seededShuffle([], seededRandom('x'))).toEqual([]);
		expect(seededShuffle(['only'], seededRandom('x'))).toEqual(['only']);
	});

	it('reaches different orders for different seeds (it is not a fixed order)', () => {
		const items = ['a', 'b', 'c', 'd', 'e', 'f'];
		const orders = new Set(
			Array.from({ length: 30 }, (_, i) => seededShuffle(items, seededRandom(`s${i}`)).join(''))
		);
		expect(orders.size).toBeGreaterThan(10);
	});
});

describe('buildQuiz', () => {
	const deck = ['RIP', 'EIGRP', 'BGP', 'IS-IS', 'OSPF v3'];
	const build = (over: Partial<Parameters<typeof buildQuiz>[0]> = {}) =>
		buildQuiz({
			correct: 'OSPF',
			sameDeck: deck,
			others: ['VLAN', 'STP'],
			seed: 'seed:1:0',
			...over
		});

	it('has the right answer exactly once among four distinct options, with its index', () => {
		const question = build()!;
		expect(question.options).toHaveLength(1 + WRONG_OPTIONS);
		expect(question.options.filter((option) => option === 'OSPF')).toHaveLength(1);
		expect(question.options[question.correctIndex]).toBe('OSPF');
		expect(new Set(question.options.map(answerKey)).size).toBe(question.options.length);
	});

	it('takes the wrong answers from the same deck when it has enough, and only then from elsewhere', () => {
		for (let i = 0; i < 40; i++) {
			const question = build({ seed: `s${i}` })!;
			const wrong = question.options.filter((option) => option !== 'OSPF');
			expect(
				wrong.every((option) => deck.includes(option)),
				question.options.join()
			).toBe(true);
		}
		const sparse = build({ sameDeck: ['RIP', 'BGP'], others: ['VLAN', 'STP', 'LACP'] })!;
		expect(sparse.options).toContain('RIP');
		expect(sparse.options).toContain('BGP');
		expect(sparse.options.filter((o) => ['VLAN', 'STP', 'LACP'].includes(o))).toHaveLength(1);
	});

	it('never shows the right answer again as a wrong one, in any case or spacing, for any seed', () => {
		for (let i = 0; i < 80; i++) {
			const question = buildQuiz({
				correct: 'show ip route',
				sameDeck: [
					'Show IP Route',
					'  show   ip  route  ',
					'show ip ospf',
					'show run',
					'show vlan',
					'show cdp'
				],
				others: ['SHOW IP ROUTE'],
				seed: `seed-${i}`
			})!;
			expect(
				question.options.filter((o) => answerKey(o) === 'show ip route'),
				question.options.join('|')
			).toHaveLength(1);
			expect(question.options[question.correctIndex]).toBe('show ip route');
		}
	});

	it('never repeats a wrong answer that two cards share', () => {
		const question = buildQuiz({
			correct: 'A',
			sameDeck: ['B', 'b', ' B ', 'C', 'c', 'D', 'd'],
			others: ['B', 'E'],
			seed: 'x'
		})!;
		expect(new Set(question.options.map(answerKey)).size).toBe(4);
	});

	it('skips candidates that cannot be options: empty, long, multi-line', () => {
		const question = buildQuiz({
			correct: 'A',
			sameDeck: ['', '   ', 'x'.repeat(MAX_ANSWER_LENGTH + 1), 'two\nlines', 'B', 'C', 'D'],
			others: [],
			seed: 'x'
		})!;
		expect([...question.options].sort()).toEqual(['A', 'B', 'C', 'D']);
	});

	it('trims the options it shows', () => {
		const question = buildQuiz({
			correct: '  A  ',
			sameDeck: [' B ', ' C ', ' D '],
			others: [],
			seed: 'x'
		})!;
		expect([...question.options].sort()).toEqual(['A', 'B', 'C', 'D']);
	});

	it('says it cannot build a question when there are fewer than three usable wrong answers', () => {
		expect(build({ sameDeck: ['RIP', 'BGP'], others: [] })).toBeUndefined();
		expect(build({ sameDeck: ['RIP', 'rip', 'RIP '], others: ['OSPF', 'ospf'] })).toBeUndefined();
		expect(build({ sameDeck: [], others: [] })).toBeUndefined();
	});

	it('says it cannot build one when the right answer is not usable', () => {
		for (const correct of ['', '  ', 'two\nlines', 'x'.repeat(MAX_ANSWER_LENGTH + 1)]) {
			expect(build({ correct }), JSON.stringify(correct).slice(0, 30)).toBeUndefined();
		}
	});

	it('is the same question for the same seed, and does not depend on the order the pool was read in', () => {
		const first = build({ seed: 'session:7:0' })!;
		expect(build({ seed: 'session:7:0' })).toEqual(first);
		expect(build({ seed: 'session:7:0', sameDeck: [...deck].reverse() })).toEqual(first);
		expect(
			build({ seed: 'session:7:0', sameDeck: seededShuffle(deck, seededRandom('z')) })
		).toEqual(first);
	});

	it('changes with the seed: another session, card, or item shows a different arrangement', () => {
		const seen = new Set(
			Array.from({ length: 40 }, (_, i) => build({ seed: `session:${i}:0` })!.options.join('|'))
		);
		expect(seen.size).toBeGreaterThan(10);
		// The right answer is not always in the same place.
		const places = new Set(
			Array.from({ length: 40 }, (_, i) => build({ seed: `place:${i}` })!.correctIndex)
		);
		expect(places.size).toBe(4);
	});

	it('does not change what it was given', () => {
		const same = [...deck];
		const others = ['VLAN', 'STP', 'LACP'];
		build({ sameDeck: same, others });
		expect(same).toEqual(deck);
		expect(others).toEqual(['VLAN', 'STP', 'LACP']);
	});

	it('handles answers with markup and code as plain text', () => {
		const question = buildQuiz({
			correct: '`show ip route`',
			sameDeck: ['`show run`', '**bold**', '<b>x</b>'],
			others: [],
			seed: 'x'
		})!;
		expect(question.options[question.correctIndex]).toBe('`show ip route`');
		expect(question.options).toContain('<b>x</b>');
	});
});
