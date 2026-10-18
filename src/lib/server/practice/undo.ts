import { err, ok, type Result } from '#lib/core/result.ts';
import { withTx, type Db } from '../db/index.ts';
import { deletePracticeLog, getReviewLog, newestReviewLogId } from '../repos/index.ts';

export type PracticeUndoFailureCode = 'not_found' | 'not_latest';

export interface PracticeUndoFailure {
	code: PracticeUndoFailureCode;
	message: string;
}

// Takes back the most recent practice answer (ADR-019): deletes that one row of the review log. Practice never
// changed a schedule, so there is nothing to restore. Only the newest practice answer overall can go, and a study
// answer is never touched (the delete is limited to mode 'cram').
export function undoPractice(
	db: Db,
	input: { reviewId: string }
): Result<
	{ reviewId: string; cardPk: number; ordinal: number; right: boolean },
	PracticeUndoFailure
> {
	return withTx(db, (tx) => {
		const row = getReviewLog(tx, input.reviewId);
		if (!row || row.mode !== 'cram') {
			return err({ code: 'not_found', message: 'There is no practice answer with that id.' });
		}
		if (newestReviewLogId(tx, 'cram') !== row.id) {
			return err({
				code: 'not_latest',
				message: 'Only your most recent practice answer can be undone, and a newer one exists.'
			});
		}
		deletePracticeLog(tx, row.id);
		return ok({
			reviewId: row.id,
			cardPk: row.cardPk,
			ordinal: row.ordinal,
			right: row.grade >= 3
		});
	});
}
