import type { ReviewResultDto, SerializedState } from '#lib/core/api-types.ts';
import { err, ok, type Result } from '#lib/core/result.ts';
import {
	createScheduler,
	DEFAULT_SCHEDULER_CONFIG,
	type Scheduler
} from '#lib/core/scheduler/index.ts';
import type { Grade } from '#lib/core/scheduler/types.ts';
import { nextRollover } from '#lib/core/study-day.ts';
import type { Clock } from '../clock.ts';
import { withTx, type Db } from '../db/index.ts';
import {
	getCard,
	getDeck,
	getReviewLog,
	getSettings,
	getState,
	insertReviewLog,
	listStatesForCards,
	updateState
} from '../repos/index.ts';
import type { ReviewInput } from './schema.ts';
import { serializeState, toItemState, toPreColumns, toStatePatch } from './state.ts';

export type ReviewFailureCode = 'not_found' | 'stale_review' | 'review_id_reused';

export interface ReviewFailure {
	code: ReviewFailureCode;
	message: string;
}

// An ItemState with dates as ISO strings, as stored in review_log.result and sent to the client.
// Defined in core/api-types.ts so the browser shares it. replayed is true when the id was already
// recorded, and becameLeech is true only on the review that crosses the leech threshold.
export type { SerializedState };
export type ReviewResult = ReviewResultDto;

export interface SubmitContext {
	clock: Clock;
	timeZone: string;
}

export { serializeState };

// One scheduler per target retention is plenty. They are stateless.
const schedulers = new Map<number, Scheduler>();
export function schedulerFor(targetRetention: number): Scheduler {
	let scheduler = schedulers.get(targetRetention);
	if (!scheduler) {
		scheduler = createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, targetRetention });
		schedulers.set(targetRetention, scheduler);
	}
	return scheduler;
}

// Records one answer (ADR-003). Everything happens in one transaction, so a crash can never leave
// the schedule changed without its log row, or the reverse.
export function submitReview(
	db: Db,
	input: ReviewInput,
	context: SubmitContext
): Result<ReviewResult, ReviewFailure> {
	return withTx(db, (tx) => {
		// 1. A repeated id returns the stored result. Checked first: after the first submit the item's
		// lastReview is newer than servedAt, so a replay would otherwise look stale.
		const existing = getReviewLog(tx, input.reviewId);
		if (existing) {
			// A practice row (mode 'cram') has no stored result and is not a review: its id cannot be reused here.
			if (
				existing.mode !== 'review' ||
				existing.cardPk !== input.cardPk ||
				existing.ordinal !== input.ordinal
			) {
				return err({
					code: 'review_id_reused',
					message: 'This reviewId was already used for a different card.'
				});
			}
			return ok({
				reviewId: input.reviewId,
				replayed: true,
				cardPk: existing.cardPk,
				ordinal: existing.ordinal,
				grade: existing.grade as Grade,
				next: existing.result as unknown as SerializedState,
				becameLeech: false
			});
		}

		// 2. The item must exist.
		const card = getCard(tx, input.cardPk);
		const row = getState(tx, input.cardPk, input.ordinal);
		if (!card || !row) {
			return err({ code: 'not_found', message: 'That card or review item does not exist.' });
		}

		// 3. Another tab may have graded this item after it was served here.
		if (row.lastReview !== null && row.lastReview > input.servedAt) {
			return err({
				code: 'stale_review',
				message: 'This card was already reviewed after it was shown. Load the next card.'
			});
		}

		// 4. Schedule it, honoring the deck's target retention override.
		const now = context.clock.now();
		const settings = getSettings(tx);
		const deck = getDeck(tx, card.deckId);
		const scheduler = schedulerFor(deck?.targetRetention ?? settings.targetRetention);
		const before = toItemState(row);
		const next = scheduler.review(before, input.grade, now);

		// 5. Leech: flag once when lapses reach the threshold. The flag stays until the user resets it.
		const becameLeech = !row.leech && next.lapses >= settings.leechThreshold;

		updateState(tx, input.cardPk, input.ordinal, {
			...toStatePatch(next),
			...(becameLeech ? { leech: true } : {})
		});

		// 6. Siblings of a cloze item are buried until the next study day so one card does not
		// quiz the learner several times in a row.
		const siblings = listStatesForCards(tx, [input.cardPk]).filter(
			(s) => s.ordinal !== input.ordinal && !s.archived
		);
		if (siblings.length > 0) {
			const until = nextRollover(now, context.timeZone, settings.rolloverHour).toISOString();
			for (const sibling of siblings) {
				updateState(tx, input.cardPk, sibling.ordinal, { buriedUntil: until });
			}
		}

		const serialized = serializeState(next);
		insertReviewLog(tx, {
			id: input.reviewId,
			cardPk: input.cardPk,
			ordinal: input.ordinal,
			mode: 'review',
			grade: input.grade,
			...toPreColumns(before),
			result: serialized as unknown as Record<string, unknown>,
			scheduledDays: next.scheduledDays,
			durationMs: input.durationMs ?? null,
			typedAnswer: input.typedAnswer ?? null,
			reviewedAt: now.toISOString()
		});

		return ok({
			reviewId: input.reviewId,
			replayed: false,
			cardPk: input.cardPk,
			ordinal: input.ordinal,
			grade: input.grade,
			next: serialized,
			becameLeech
		});
	});
}
