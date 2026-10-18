import { err, ok, type Result } from '#lib/core/result.ts';
import type { Clock } from '../clock.ts';
import { withTx, type Db } from '../db/index.ts';
import { getReviewLog, getState, insertReviewLog } from '../repos/index.ts';
import { toItemState, toPreColumns } from '../study/state.ts';
import { getPracticeItem } from './item.ts';
import type { PracticeGradeInput } from './schema.ts';

export type PracticeFailureCode = 'not_found' | 'review_id_reused';

export interface PracticeFailure {
	code: PracticeFailureCode;
	message: string;
}

// Records one practice answer (ADR-017). It adds one row to the review log with mode 'cram' and changes nothing
// else: not the card's schedule, not its burying, not its leech flag. The item's state is only read, to keep the
// "before" columns the log requires. Everything that counts study (limits, retention, streaks, leeches, weak
// tags, statistics) reads mode 'review' rows only, so these rows count in none of them.
export function recordPractice(
	db: Db,
	input: PracticeGradeInput,
	context: { clock: Clock }
): Result<{ replayed: boolean }, PracticeFailure> {
	return withTx(db, (tx) => {
		const existing = getReviewLog(tx, input.reviewId);
		if (existing) {
			if (
				existing.mode !== 'cram' ||
				existing.cardPk !== input.cardPk ||
				existing.ordinal !== input.ordinal
			) {
				return err({
					code: 'review_id_reused',
					message: 'This reviewId was already used for a different answer.'
				});
			}
			return ok({ replayed: true });
		}

		const state = getState(tx, input.cardPk, input.ordinal);
		if (!state || !getPracticeItem(tx, input.cardPk, input.ordinal)) {
			return err({ code: 'not_found', message: 'That card or review item cannot be practiced.' });
		}

		insertReviewLog(tx, {
			id: input.reviewId,
			cardPk: input.cardPk,
			ordinal: input.ordinal,
			mode: 'cram',
			grade: input.right ? 3 : 1,
			...toPreColumns(toItemState(state)),
			result: null,
			scheduledDays: null,
			durationMs: input.durationMs ?? null,
			typedAnswer: input.typedAnswer ?? null,
			reviewedAt: context.clock.now().toISOString()
		});
		return ok({ replayed: false });
	});
}
