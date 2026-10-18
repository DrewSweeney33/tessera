// Practice again (ADR-017): going through a deck or a folder again without touching the schedule.
//
// Everything here is pure. The server picks and orders the items (`orderPool`); the browser runs the session with
// `PracticeState`, which loops a missed item back until it has been answered right once. Nothing in this file
// knows about the scheduler's `review`, on purpose: practice must not be able to change a schedule.

export interface PracticeRef {
	cardPk: number;
	ordinal: number;
}

export type PracticeOrder = 'shuffle' | 'weakest';

// A random number in [0, 1), injected like everywhere else in core and server.
export type RandomSource = () => number;

// A missed item comes back after this many other items (or at the end when fewer are left).
export const REQUEUE_GAP = 4;

export function refKey(ref: PracticeRef): string {
	return `${ref.cardPk}:${ref.ordinal}`;
}

// An item that could be practiced, with what the weakest-first order needs.
export interface PoolItem extends PracticeRef {
	// The chance of remembering it now, from the read-only scheduler. Null for an item never studied.
	retrievability: number | null;
	lapses: number;
}

function byRef(a: PracticeRef, b: PracticeRef): number {
	return a.cardPk - b.cardPk || a.ordinal - b.ordinal;
}

// Fisher-Yates over a copy. Starts from a fixed order, so the same rng gives the same result.
export function shuffled<T extends PracticeRef>(items: readonly T[], random: RandomSource): T[] {
	const result = [...items].sort(byRef);
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.min(i, Math.floor(random() * (i + 1)));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

// Studied items from the least to the most likely to be remembered (then the most lapses), then the items never
// studied in file order.
export function weakestFirst<T extends PoolItem>(items: readonly T[]): T[] {
	const studied = items
		.filter((item) => item.retrievability !== null)
		.sort((a, b) => a.retrievability! - b.retrievability! || b.lapses - a.lapses || byRef(a, b));
	const unstudied = items.filter((item) => item.retrievability === null).sort(byRef);
	return [...studied, ...unstudied];
}

// Orders the pool, then keeps the first `count` (all of them when `count` is 'all' or larger than the pool).
export function orderPool(
	pool: readonly PoolItem[],
	options: { order: PracticeOrder; count: number | 'all'; random: RandomSource }
): PracticeRef[] {
	const ordered = options.order === 'weakest' ? weakestFirst(pool) : shuffled(pool, options.random);
	const kept = options.count === 'all' ? ordered : ordered.slice(0, options.count);
	return kept.map(({ cardPk, ordinal }) => ({ cardPk, ordinal }));
}

// A session in progress. Plain data, so the browser can keep it in sessionStorage.
export interface PracticeState {
	// Items still to be answered right. The first is the one on screen. Each item appears once.
	queue: PracticeRef[];
	// How many different items the session started with.
	total: number;
	// Answers given, right or missed.
	answers: number;
	// Keys (`cardPk:ordinal`) of the items missed at least once.
	missed: string[];
}

export function startPractice(items: readonly PracticeRef[]): PracticeState {
	const seen = new Set<string>();
	const queue: PracticeRef[] = [];
	for (const item of items) {
		const key = refKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		queue.push({ cardPk: item.cardPk, ordinal: item.ordinal });
	}
	return { queue, total: queue.length, answers: 0, missed: [] };
}

export function currentItem(state: PracticeState): PracticeRef | undefined {
	return state.queue[0];
}

export function isFinished(state: PracticeState): boolean {
	return state.queue.length === 0;
}

// Records one answer for the current item. A right answer takes the item out; a missed one puts it back
// `REQUEUE_GAP` places later. Returns the same state when the session is already finished.
export function answerPractice(state: PracticeState, right: boolean): PracticeState {
	const [current, ...rest] = state.queue;
	if (current === undefined) return state;
	if (right) return { ...state, queue: rest, answers: state.answers + 1 };
	const key = refKey(current);
	const at = Math.min(REQUEUE_GAP, rest.length);
	return {
		...state,
		queue: [...rest.slice(0, at), current, ...rest.slice(at)],
		answers: state.answers + 1,
		missed: state.missed.includes(key) ? state.missed : [...state.missed, key]
	};
}

// Drops the current item without an answer, for an item that can no longer be practiced (its card was removed
// meanwhile). It leaves the totals as if the item had never been in the session.
export function skipPractice(state: PracticeState): PracticeState {
	const [current, ...rest] = state.queue;
	if (current === undefined) return state;
	const key = refKey(current);
	return {
		...state,
		queue: rest,
		total: state.total - 1,
		missed: state.missed.filter((entry) => entry !== key)
	};
}

// The items that needed more than one round, for "Practice the misses again".
export function missedItems(state: PracticeState): PracticeRef[] {
	return state.missed.map((key) => {
		const [cardPk, ordinal] = key.split(':').map(Number);
		return { cardPk: cardPk!, ordinal: ordinal! };
	});
}

export interface PracticeSummary {
	total: number;
	answers: number;
	// Items answered right the first time they were shown.
	rightFirstTime: number;
	// Items that needed more than one round.
	needMoreRounds: number;
	// Items still to answer right.
	remaining: number;
}

export function summarize(state: PracticeState): PracticeSummary {
	// Items never missed and already out of the queue were right the first time they were shown.
	const notMissedYet = state.queue.filter((ref) => !state.missed.includes(refKey(ref))).length;
	return {
		total: state.total,
		answers: state.answers,
		rightFirstTime: state.total - state.missed.length - notMissedYet,
		needMoreRounds: state.missed.length,
		remaining: state.queue.length
	};
}

// How far through the session: the share of the starting items answered right at least once.
export function progress(state: PracticeState): number {
	return state.total === 0 ? 1 : (state.total - state.queue.length) / state.total;
}

function isRef(value: unknown): value is PracticeRef {
	if (typeof value !== 'object' || value === null) return false;
	const { cardPk, ordinal } = value as Record<string, unknown>;
	return (
		Number.isInteger(cardPk) &&
		(cardPk as number) > 0 &&
		Number.isInteger(ordinal) &&
		(ordinal as number) >= 0 &&
		(ordinal as number) < 100
	);
}

// Reads a state back from storage. Anything that is not exactly a state is refused, so a stale or hand-edited
// value can never start a broken session.
export function parsePracticeState(value: unknown): PracticeState | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const { queue, total, answers, missed } = value as Record<string, unknown>;
	if (!Array.isArray(queue) || !queue.every(isRef)) return undefined;
	if (!Array.isArray(missed) || !missed.every((key) => typeof key === 'string')) return undefined;
	if (!Number.isInteger(total) || !Number.isInteger(answers)) return undefined;
	if ((total as number) < queue.length || (answers as number) < 0) return undefined;
	const keys = new Set(queue.map(refKey));
	if (keys.size !== queue.length) return undefined;
	return {
		queue: queue.map(({ cardPk, ordinal }) => ({ cardPk, ordinal })),
		total: total as number,
		answers: answers as number,
		missed: missed as string[]
	};
}
