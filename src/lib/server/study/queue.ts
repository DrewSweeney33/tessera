import type { QueueCategory, QueueCounts } from '#lib/core/api-types.ts';
import { createReader } from '#lib/core/scheduler/read.ts';
import { nextRollover, studyDayStart } from '#lib/core/study-day.ts';
import type { Rng } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import type { CardRow, CardStateRow } from '../db/schema.ts';
import {
	countByPhase,
	countNewIntroducedSince,
	countReviewsSince,
	getSettings,
	listDecksInScope,
	listLearning,
	listNew,
	listReviewDue,
	nextLearningDue,
	type QueueRow,
	type QueueScope
} from '../repos/index.ts';
import { toItemState } from './state.ts';

// Learning cards due within this window are shown early, but only when nothing else is left.
export const LEARN_AHEAD_MS = 20 * 60_000;

// Reviews due today are ranked in memory by recall probability, so cap how many are fetched.
const REVIEW_CANDIDATE_LIMIT = 5000;
const NEW_INTERLEAVE_WINDOW = 50;

// Shared with the browser through core/api-types.ts.
export type { QueueCategory, QueueCounts };

export interface QueueItem {
	category: QueueCategory;
	card: CardRow;
	state: CardStateRow;
}

export type QueueResult =
	| { kind: 'item'; item: QueueItem }
	// Nothing to study now. waitingUntil is the next learning item that falls due later today.
	| { kind: 'empty'; waitingUntil: Date | undefined };

export interface QueueOptions {
	scope: QueueScope;
	now: Date;
	timeZone: string;
	rng: Rng;
}

const reader = createReader();

function item(category: QueueCategory, row: QueueRow): QueueResult {
	return { kind: 'item', item: { category, card: row.card, state: row.state } };
}

function sum(counts: Map<string, number>): number {
	let total = 0;
	for (const n of counts.values()) total += n;
	return total;
}

// Chooses the next item to study (ADR-003, refined: learn-ahead is a last resort).
//
//   1. Learning and relearning items due now, earliest first.
//   2. Review items due before the study day ends, lowest recall probability first,
//      unless the daily review limit is reached. With interleave on, random.
//   3. New items, in deck then file order, per deck up to its daily limit. With interleave on, random.
//   4. Learning items due within the next 20 minutes (learn ahead).
//   5. Nothing: report when the next learning item is due, if any is due later today.
export function selectNext(x: Executor, options: QueueOptions): QueueResult {
	const { scope, now, timeZone, rng } = options;
	const settings = getSettings(x);
	const nowIso = now.toISOString();
	const dayStart = studyDayStart(now, timeZone, settings.rolloverHour);
	const dayEnd = nextRollover(now, timeZone, settings.rolloverHour);

	const learningNow = listLearning(x, { nowIso, untilIso: nowIso, scope, limit: 1 })[0];
	if (learningNow) return item('learning', learningNow);

	if (countReviewsSince(x, dayStart.toISOString()) < settings.reviewsPerDay) {
		const due = listReviewDue(x, {
			nowIso,
			dueBeforeIso: dayEnd.toISOString(),
			scope,
			limit: REVIEW_CANDIDATE_LIMIT
		});
		if (due.length > 0) {
			if (settings.interleave) return item('review', due[Math.floor(rng() * due.length)]!);
			let best = due[0]!;
			let bestRecall = reader.retrievability(toItemState(best.state), now);
			for (const row of due) {
				const recall = reader.retrievability(toItemState(row.state), now);
				if (recall < bestRecall) {
					best = row;
					bestRecall = recall;
				}
			}
			return item('review', best);
		}
	}

	const introduced = countNewIntroducedSince(x, dayStart.toISOString());
	const decksWithRoom = listDecksInScope(x, scope)
		.filter((deck) => (introduced.get(deck.id) ?? 0) < (deck.newPerDay ?? settings.newPerDay))
		.map((deck) => deck.id);
	const fresh = listNew(x, {
		nowIso,
		deckIds: decksWithRoom,
		limit: settings.interleave ? NEW_INTERLEAVE_WINDOW : 1
	});
	if (fresh.length > 0)
		return item('new', fresh[Math.floor((settings.interleave ? rng() : 0) * fresh.length)]!);

	const aheadIso = new Date(now.getTime() + LEARN_AHEAD_MS).toISOString();
	const ahead = listLearning(x, { nowIso, untilIso: aheadIso, scope, limit: 1 })[0];
	if (ahead) return item('learning', ahead);

	const waiting = nextLearningDue(x, {
		nowIso,
		afterIso: aheadIso,
		beforeIso: dayEnd.toISOString(),
		scope
	});
	return { kind: 'empty', waitingUntil: waiting ? new Date(waiting) : undefined };
}

// How many items are available right now, with the same filters and limits as selectNext.
// The home screen uses this so its numbers always agree with a study session.
export function countQueue(
	x: Executor,
	options: { scope: QueueScope; now: Date; timeZone: string }
): QueueCounts {
	const { scope, now, timeZone } = options;
	const settings = getSettings(x);
	const nowIso = now.toISOString();
	const dayStart = studyDayStart(now, timeZone, settings.rolloverHour);
	const dayEnd = nextRollover(now, timeZone, settings.rolloverHour);

	const learning = sum(countByPhase(x, { nowIso, scope, phases: [1, 3], dueBeforeIso: nowIso }));

	const reviewsLeft = Math.max(
		0,
		settings.reviewsPerDay - countReviewsSince(x, dayStart.toISOString())
	);
	const reviewsDue = sum(
		countByPhase(x, { nowIso, scope, phases: [2], dueBeforeIso: dayEnd.toISOString() })
	);

	const introduced = countNewIntroducedSince(x, dayStart.toISOString());
	const newByDeck = countByPhase(x, { nowIso, scope, phases: [0] });
	let fresh = 0;
	for (const deck of listDecksInScope(x, scope)) {
		const room = Math.max(
			0,
			(deck.newPerDay ?? settings.newPerDay) - (introduced.get(deck.id) ?? 0)
		);
		fresh += Math.min(newByDeck.get(deck.id) ?? 0, room);
	}

	return { learning, review: Math.min(reviewsDue, reviewsLeft), new: fresh };
}
