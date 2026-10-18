import type { PracticeStartResponse } from '#lib/core/api-types.ts';
import { orderPool, type PoolItem, type PracticeOrder } from '#lib/core/practice.ts';
import { createReader } from '#lib/core/scheduler/read.ts';
import type { Rng } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import { listPracticePool, type QueueScope } from '../repos/index.ts';
import { toItemState } from '../study/state.ts';

// Which items a practice session can show and in what order (ADR-017). Reads only: nothing here can write a
// schedule. The pool is everything active in the scope, whatever its due date and whether or not it is buried.

const reader = createReader();

export function practicePool(x: Executor, scope: QueueScope, now: Date): PoolItem[] {
	return listPracticePool(x, scope).map(({ state }) => ({
		cardPk: state.cardPk,
		ordinal: state.ordinal,
		// A new item has no memory to measure; the weakest-first order puts it last.
		retrievability: state.phase === 0 ? null : reader.retrievability(toItemState(state), now),
		lapses: state.lapses
	}));
}

export function poolCounts(
	x: Executor,
	scope: QueueScope,
	now: Date
): { total: number; unstudied: number } {
	const pool = practicePool(x, scope, now);
	return {
		total: pool.length,
		unstudied: pool.filter((item) => item.retrievability === null).length
	};
}

export function startPracticeSession(
	x: Executor,
	args: { scope: QueueScope; count: number | 'all'; order: PracticeOrder },
	context: { now: Date; rng: Rng }
): PracticeStartResponse {
	const pool = practicePool(x, args.scope, context.now);
	return {
		items: orderPool(pool, { order: args.order, count: args.count, random: context.rng }),
		poolSize: pool.length
	};
}
