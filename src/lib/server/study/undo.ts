import type { SerializedState } from '#lib/core/api-types.ts';
import { err, ok, type Result } from '#lib/core/result.ts';
import type { Grade } from '#lib/core/scheduler/types.ts';
import { nextRollover } from '#lib/core/study-day.ts';
import { withTx, type Db } from '../db/index.ts';
import {
	deleteStudyLog,
	getReviewLog,
	getSettings,
	getState,
	listStatesForCards,
	newestReviewLogId,
	updateState
} from '../repos/index.ts';
import { serializeState } from './submit.ts';
import { toItemState } from './state.ts';

export type UndoFailureCode = 'not_found' | 'not_latest' | 'changed_since';

export interface UndoFailure {
	code: UndoFailureCode;
	message: string;
}

export interface UndoResult {
	reviewId: string;
	cardPk: number;
	ordinal: number;
	grade: Grade;
	// The item's state after the undo, which is its state before the answer.
	restored: SerializedState;
	// True when the answer made the card a leech and the flag was taken off again.
	leechCleared: boolean;
	// How many cloze siblings the answer had buried and are available again.
	siblingsUnburied: number;
}

// The fields of a serialized state, compared one by one (the stored result is JSON, the item is a row).
const STATE_FIELDS = [
	'due',
	'stability',
	'difficulty',
	'elapsedDays',
	'scheduledDays',
	'learningSteps',
	'reps',
	'lapses',
	'phase',
	'lastReview'
] as const;

function sameState(a: SerializedState, b: Record<string, unknown> | null): boolean {
	if (b === null) return false;
	return STATE_FIELDS.every((field) => a[field] === b[field]);
}

// Undoes the most recent study answer (ADR-019). Everything happens in one transaction, so a crash can never leave
// the schedule restored with the answer still logged, or the reverse. It is allowed only for the newest study
// answer overall and only while the item is exactly as that answer left it, so an old tab or a second tab cannot
// rewrite a schedule out of order. The log row is deleted, so every number that is computed from the log (reviews
// today, the streak, retention, the daily limits, the forecast) is right again without changing any query.
export function undoReview(
	db: Db,
	input: { reviewId: string },
	context: { timeZone: string }
): Result<UndoResult, UndoFailure> {
	return withTx(db, (tx) => {
		const row = getReviewLog(tx, input.reviewId);
		if (!row || row.mode !== 'review') {
			return err({ code: 'not_found', message: 'There is no study answer with that id.' });
		}
		if (newestReviewLogId(tx, 'review') !== row.id) {
			return err({
				code: 'not_latest',
				message: 'Only your most recent answer can be undone, and a newer one exists.'
			});
		}
		const state = getState(tx, row.cardPk, row.ordinal);
		if (!state) {
			return err({ code: 'not_found', message: 'That card or review item no longer exists.' });
		}
		if (!sameState(serializeState(toItemState(state)), row.result)) {
			return err({
				code: 'changed_since',
				message: 'This card was changed after the answer (it was reset or reviewed again).'
			});
		}

		const settings = getSettings(tx);
		// The leech flag is set once, when the lapses reach the threshold. If this answer was the one that crossed it,
		// the card was not a leech before it.
		const afterLapses = (row.result as { lapses?: unknown } | null)?.lapses;
		const leechCleared =
			state.leech &&
			row.preLapses < settings.leechThreshold &&
			typeof afterLapses === 'number' &&
			afterLapses >= settings.leechThreshold;

		const restored = restoredColumns(row);
		updateState(tx, row.cardPk, row.ordinal, {
			...restored,
			...(leechCleared ? { leech: false } : {})
		});

		// The answer buried the other items of the same card until the next rollover after it. Free them again if they
		// are still buried until exactly that moment. If the rollover hour was changed in between they do not match
		// and stay buried until the next study day, which is the safe way to be wrong.
		const until = nextRollover(
			new Date(row.reviewedAt),
			context.timeZone,
			settings.rolloverHour
		).toISOString();
		let siblingsUnburied = 0;
		for (const sibling of listStatesForCards(tx, [row.cardPk])) {
			if (sibling.ordinal === row.ordinal || sibling.buriedUntil !== until) continue;
			updateState(tx, row.cardPk, sibling.ordinal, { buriedUntil: null });
			siblingsUnburied += 1;
		}

		deleteStudyLog(tx, row.id);

		return ok({
			reviewId: row.id,
			cardPk: row.cardPk,
			ordinal: row.ordinal,
			grade: row.grade as Grade,
			restored: serializeState(toItemState({ ...state, ...restored })),
			leechCleared,
			siblingsUnburied
		});
	});
}

function restoredColumns(row: NonNullable<ReturnType<typeof getReviewLog>>) {
	return {
		due: row.preDue,
		stability: row.preStability,
		difficulty: row.preDifficulty,
		elapsedDays: row.preElapsedDays,
		scheduledDays: row.preScheduledDays,
		learningSteps: row.preLearningSteps,
		reps: row.preReps,
		lapses: row.preLapses,
		phase: row.prePhase,
		lastReview: row.preLastReview
	};
}
