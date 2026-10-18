import { describe, expect, it } from 'vitest';
import {
	REQUEUE_GAP,
	answerPractice,
	currentItem,
	isFinished,
	missedItems,
	orderPool,
	parsePracticeState,
	progress,
	shuffled,
	skipPractice,
	startPractice,
	summarize,
	weakestFirst,
	type PoolItem,
	type PracticeRef,
	type PracticeState
} from '#lib/core/practice.ts';

// Practice again (ADR-017): the order of a session and the loop that brings a missed card back.

const ref = (cardPk: number, ordinal = 0): PracticeRef => ({ cardPk, ordinal });
const refs = (...numbers: number[]) => numbers.map((number) => ref(number));
const pks = (items: PracticeRef[]) => items.map((entry) => entry.cardPk);
const item = (
	cardPk: number,
	retrievability: number | null,
	lapses = 0,
	ordinal = 0
): PoolItem => ({ cardPk, ordinal, retrievability, lapses });

// A tiny repeatable random source: a fixed list, cycled.
function sequence(...values: number[]): () => number {
	let at = 0;
	return () => values[at++ % values.length]!;
}

describe('shuffled', () => {
	it('is a permutation and does not change its input', () => {
		const input = [ref(5), ref(1), ref(3), ref(2), ref(4)];
		const copy = structuredClone(input);
		const result = shuffled(input, sequence(0.9, 0.1, 0.5, 0.3));
		expect(input).toEqual(copy);
		expect(pks(result).sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('gives the same order for the same random numbers whatever the input order', () => {
		const a = shuffled([ref(3), ref(1), ref(2), ref(4)], sequence(0.2, 0.8, 0.4));
		const b = shuffled([ref(4), ref(2), ref(1), ref(3)], sequence(0.2, 0.8, 0.4));
		expect(pks(a)).toEqual(pks(b));
	});

	it('can put different items first (the random number reaches the positions)', () => {
		const firsts = new Set<number>();
		for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
			firsts.add(shuffled(refs(1, 2, 3, 4), sequence(r))[0]!.cardPk);
		}
		expect(firsts.size).toBeGreaterThan(1);
	});

	it('copes with random numbers at the ends of the range', () => {
		expect(pks(shuffled(refs(1, 2, 3), () => 0)).sort()).toEqual([1, 2, 3]);
		expect(pks(shuffled(refs(1, 2, 3), () => 0.999999)).sort()).toEqual([1, 2, 3]);
		expect(shuffled([], () => 0)).toEqual([]);
	});
});

describe('weakestFirst', () => {
	it('puts the least likely to be remembered first, then the most lapses, then file order', () => {
		const result = weakestFirst([
			item(1, 0.9),
			item(2, 0.4, 1),
			item(3, 0.4, 5),
			item(4, 0.2),
			item(5, 0.4, 5, 1)
		]);
		expect(result.map((entry) => `${entry.cardPk}:${entry.ordinal}`)).toEqual([
			'4:0',
			'3:0',
			'5:1',
			'2:0',
			'1:0'
		]);
	});

	it('puts items never studied last, in file order, however weak the others look', () => {
		const result = weakestFirst([item(3, null), item(1, 0.99), item(2, null), item(4, 0.95)]);
		expect(pks(result)).toEqual([4, 1, 2, 3]);
	});
});

describe('orderPool', () => {
	const pool = [item(1, 0.5), item(2, 0.1), item(3, null), item(4, 0.9)];

	it('keeps the first `count` after ordering, and returns references only', () => {
		const result = orderPool(pool, { order: 'weakest', count: 2, random: () => 0 });
		expect(result).toEqual([ref(2), ref(1)]);
	});

	it('takes everything for "all" or a count larger than the pool', () => {
		expect(orderPool(pool, { order: 'weakest', count: 'all', random: () => 0 })).toHaveLength(4);
		expect(orderPool(pool, { order: 'shuffle', count: 100, random: () => 0 })).toHaveLength(4);
	});

	it('cuts a shuffled pool to the count without repeating an item', () => {
		const result = orderPool(pool, {
			order: 'shuffle',
			count: 3,
			random: sequence(0.7, 0.2, 0.5)
		});
		expect(result).toHaveLength(3);
		expect(new Set(pks(result)).size).toBe(3);
	});

	it('is empty for an empty pool', () => {
		expect(orderPool([], { order: 'shuffle', count: 'all', random: () => 0 })).toEqual([]);
	});
});

describe('the session loop', () => {
	it('starts with each item once and the first one current', () => {
		const state = startPractice([ref(1), ref(2), ref(1), ref(3)]);
		expect(pks(state.queue)).toEqual([1, 2, 3]);
		expect(state.total).toBe(3);
		expect(currentItem(state)).toEqual(ref(1));
		expect(isFinished(state)).toBe(false);
	});

	it('takes an item out when it is answered right', () => {
		let state = startPractice(refs(1, 2, 3));
		state = answerPractice(state, true);
		expect(pks(state.queue)).toEqual([2, 3]);
		expect(state.answers).toBe(1);
		expect(state.missed).toEqual([]);
	});

	it('puts a missed item back REQUEUE_GAP places later', () => {
		let state = startPractice(refs(1, 2, 3, 4, 5, 6, 7));
		state = answerPractice(state, false);
		expect(pks(state.queue)).toEqual([2, 3, 4, 5, 1, 6, 7]);
		expect(REQUEUE_GAP).toBe(4);
		expect(state.missed).toEqual(['1:0']);
	});

	it('puts a missed item at the end when fewer than the gap are left', () => {
		let state = startPractice(refs(1, 2, 3));
		state = answerPractice(state, false);
		expect(pks(state.queue)).toEqual([2, 3, 1]);
		state = answerPractice(startPractice(refs(1)), false);
		expect(pks(state.queue)).toEqual([1]);
	});

	it('runs until every item has been answered right once', () => {
		let state = startPractice(refs(1, 2, 3));
		// 1 missed -> [2,3,1]; 2 right -> [3,1]; 3 missed -> [1,3]; 1 right -> [3]; 3 right -> done
		for (const right of [false, true, false, true, true]) state = answerPractice(state, right);
		expect(isFinished(state)).toBe(true);
		expect(state.answers).toBe(5);
		expect(state.missed.sort()).toEqual(['1:0', '3:0']);
	});

	it('does nothing once the session is finished', () => {
		const finished = answerPractice(startPractice(refs(1)), true);
		expect(isFinished(finished)).toBe(true);
		expect(answerPractice(finished, false)).toBe(finished);
		expect(currentItem(finished)).toBeUndefined();
	});

	it('does not change the state it was given', () => {
		const state = startPractice(refs(1, 2, 3));
		const copy = structuredClone(state);
		answerPractice(state, false);
		expect(state).toEqual(copy);
	});

	it('keeps an item that is missed twice once in the missed list and once in the queue', () => {
		let state = startPractice(refs(1));
		state = answerPractice(state, false);
		state = answerPractice(state, false);
		expect(state.missed).toEqual(['1:0']);
		expect(state.queue).toHaveLength(1);
		expect(state.answers).toBe(2);
	});

	it('reports progress as the share of items answered right at least once', () => {
		let state = startPractice(refs(1, 2, 3, 4));
		expect(progress(state)).toBe(0);
		state = answerPractice(state, true);
		expect(progress(state)).toBe(0.25);
		state = answerPractice(state, false); // still 3 left
		expect(progress(state)).toBe(0.25);
		expect(progress(startPractice([]))).toBe(1);
	});

	it('summarizes: right first time, items that needed more rounds, and answers', () => {
		let state = startPractice(refs(1, 2, 3));
		state = answerPractice(state, false); // 1 missed -> [2,3,1]
		state = answerPractice(state, true); // 2 right
		state = answerPractice(state, true); // 3 right
		state = answerPractice(state, true); // 1 right
		expect(summarize(state)).toEqual({
			total: 3,
			answers: 4,
			rightFirstTime: 2,
			needMoreRounds: 1,
			remaining: 0
		});
	});

	it('counts an item missed and still waiting as not right the first time', () => {
		let state = startPractice(refs(1, 2));
		state = answerPractice(state, false);
		expect(summarize(state)).toMatchObject({ rightFirstTime: 0, needMoreRounds: 1, remaining: 2 });
	});

	it('lists the items that needed more rounds, for "Practice the misses again"', () => {
		let state = startPractice([ref(1, 0), ref(2, 1), ref(3, 0)]);
		state = answerPractice(state, false);
		state = answerPractice(state, true);
		expect(missedItems(state)).toEqual([ref(1, 0)]);
	});
});

describe('skipPractice', () => {
	it('drops the current item and counts it out of the session', () => {
		let state = startPractice(refs(1, 2, 3));
		state = answerPractice(state, true); // 1 right
		state = skipPractice(state); // 2 gone
		expect(pks(state.queue)).toEqual([3]);
		expect(state.total).toBe(2);
		expect(state.answers).toBe(1);
		expect(progress(state)).toBe(0.5);
	});

	it('forgets a miss on the item it drops, so the summary stays honest', () => {
		let state = startPractice(refs(1, 2));
		state = answerPractice(state, false); // 1 missed -> [2,1]
		state = answerPractice(state, true); // 2 right -> [1]
		state = skipPractice(state); // 1 gone
		expect(state.missed).toEqual([]);
		expect(state.total).toBe(1);
		expect(summarize(state)).toMatchObject({ rightFirstTime: 1, needMoreRounds: 0, remaining: 0 });
	});

	it('does nothing to a finished session', () => {
		const finished = answerPractice(startPractice(refs(1)), true);
		expect(skipPractice(finished)).toBe(finished);
	});
});

describe('parsePracticeState', () => {
	const good: PracticeState = {
		queue: [ref(1), ref(2, 1)],
		total: 3,
		answers: 4,
		missed: ['1:0']
	};

	it('accepts a state that went through JSON', () => {
		expect(parsePracticeState(JSON.parse(JSON.stringify(good)))).toEqual(good);
	});

	it('refuses anything that is not exactly a state', () => {
		const bad: unknown[] = [
			null,
			'text',
			42,
			[],
			{},
			{ ...good, queue: 'x' },
			{ ...good, queue: [{ cardPk: 0, ordinal: 0 }] },
			{ ...good, queue: [{ cardPk: 1, ordinal: -1 }] },
			{ ...good, queue: [{ cardPk: 1, ordinal: 100 }] },
			{ ...good, queue: [{ cardPk: 1.5, ordinal: 0 }] },
			{ ...good, queue: [ref(1), ref(1)] },
			{ ...good, total: 1 },
			{ ...good, total: 'x' },
			{ ...good, answers: -1 },
			{ ...good, missed: [5] },
			{ ...good, missed: 'x' }
		];
		for (const value of bad) expect(parsePracticeState(value)).toBeUndefined();
	});

	it('drops fields it does not know', () => {
		const parsed = parsePracticeState({ ...good, extra: 1, queue: [{ ...ref(1), x: 2 }] });
		expect(parsed).toEqual({ ...good, queue: [ref(1)] });
	});
});
