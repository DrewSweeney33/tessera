import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { reviewLog } from '#lib/server/db/schema.ts';
import {
	countQueue,
	submitReview,
	undoReview,
	type ReviewInput,
	type ReviewResult
} from '#lib/server/study/index.ts';
import {
	countNewIntroducedSince,
	countReviewsSince,
	getCardByKey,
	getReviewLog,
	getState,
	insertReviewLog,
	listStatesForCards,
	setSetting,
	updateState
} from '#lib/server/repos/index.ts';
import { cloze, basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Undo of the last study answer (ADR-019). The promise: answer a card, undo it, and everything is exactly as it was
// before the answer (the item's whole row, its siblings, the log, and every number counted from the log).

const TZ = 'America/Chicago';
const START = '2026-10-10T12:00:00.000Z'; // 07:00 CDT, study day ends 2026-10-11T09:00Z
const DAY_START = '2026-10-10T09:00:00.000Z';
const DAY_END = '2026-10-11T09:00:00.000Z';
const MIN = 60_000;

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(START);
	handle = openDatabase({ dataDir: dir.path, clock });
	counter = 0;
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

function seed(cards: Record<string, unknown>[]) {
	seedDeck(handle.db, makeDeck(cards, { id: 'd1', title: 'Deck' }));
}

function pk(key: string): number {
	return getCardByKey(handle.db, 'd1', key)!.pk;
}

function answer(key: string, grade: 1 | 2 | 3 | 4, ordinal = 0): ReviewResult & { id: string } {
	const input: ReviewInput = {
		reviewId: `review-${String(++counter).padStart(8, '0')}`,
		cardPk: pk(key),
		ordinal,
		grade,
		servedAt: clock.now().toISOString()
	};
	const result = submitReview(handle.db, input, { clock, timeZone: TZ });
	if (!result.ok) throw new Error(`submit failed: ${result.error.code} ${result.error.message}`);
	return { ...result.value, id: input.reviewId };
}

function undo(id: string) {
	return undoReview(handle.db, { reviewId: id }, { timeZone: TZ });
}

// Everything undo is meant to restore: the rows of a card's items and the whole log.
function snapshot(key: string) {
	return {
		states: listStatesForCards(handle.db, [pk(key)]),
		log: handle.db.select().from(reviewLog).all(),
		reviewsToday: countReviewsSince(handle.db, DAY_START),
		counts: countQueue(handle.db, { scope: {}, now: clock.now(), timeZone: TZ })
	};
}

// Moves a card to the wanted phase by answering it, advancing the clock to its due time each time.
function bring(key: string, phase: 'new' | 'learning' | 'review' | 'relearning') {
	if (phase === 'new') return;
	answer(key, 3);
	for (let i = 0; i < 8 && getState(handle.db, pk(key), 0)!.phase !== 2; i++) {
		clock.set(getState(handle.db, pk(key), 0)!.due);
		answer(key, 3);
	}
	if (phase === 'learning') return;
	if (getState(handle.db, pk(key), 0)!.phase !== 2) throw new Error('did not reach review');
	if (phase === 'relearning') {
		clock.set(getState(handle.db, pk(key), 0)!.due);
		answer(key, 1);
		expect(getState(handle.db, pk(key), 0)!.phase).toBe(3);
	}
}

describe('undo restores everything byte for byte', () => {
	for (const phase of ['new', 'learning', 'review', 'relearning'] as const) {
		for (const grade of [1, 2, 3, 4] as const) {
			it(`grade ${grade} on a card in the ${phase} phase`, () => {
				seed([basic('a'), basic('b')]);
				if (phase === 'learning') {
					// The learning phase is reached by one Good on a new card, which leaves it in learning.
					answer('a', 3);
					expect(getState(handle.db, pk('a'), 0)!.phase).toBe(1);
				} else {
					bring('a', phase);
				}
				// A moment later in the same study day, so the answer is not at the same instant as the earlier ones.
				clock.advance(MIN);
				const before = snapshot('a');

				const answered = answer('a', grade);
				expect(snapshot('a')).not.toEqual(before);

				const result = undo(answered.id);
				expect(result.ok, JSON.stringify(result)).toBe(true);
				expect(snapshot('a')).toEqual(before);
				expect(getReviewLog(handle.db, answered.id)).toBeUndefined();
			});
		}
	}

	it('returns the restored state and what it undid', () => {
		seed([basic('a')]);
		const answered = answer('a', 3);
		const result = undo(answered.id);
		if (!result.ok) throw new Error('undo failed');
		expect(result.value).toMatchObject({
			reviewId: answered.id,
			cardPk: pk('a'),
			ordinal: 0,
			grade: 3,
			leechCleared: false,
			siblingsUnburied: 0
		});
		expect(result.value.restored.reps).toBe(0);
		expect(result.value.restored.lastReview).toBeNull();
	});
});

describe('the leech flag', () => {
	it('is taken off again when the undone answer was the one that made the card a leech', () => {
		setSetting(handle.db, 'leechThreshold', 2);
		seed([basic('a')]);
		bring('a', 'review');
		clock.set(getState(handle.db, pk('a'), 0)!.due);
		answer('a', 1); // lapse 1
		clock.set(getState(handle.db, pk('a'), 0)!.due);
		bring('a', 'review'); // back to review
		const lapsesBefore = getState(handle.db, pk('a'), 0)!.lapses;
		expect(lapsesBefore).toBe(1);
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(false);
		clock.set(getState(handle.db, pk('a'), 0)!.due);
		const before = snapshot('a');

		const answered = answer('a', 1); // lapse 2: crosses the threshold
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(true);
		const result = undo(answered.id);
		if (!result.ok) throw new Error('undo failed');
		expect(result.value.leechCleared).toBe(true);
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(false);
		expect(snapshot('a')).toEqual(before);
	});

	it('is left on when the card was already a leech before the undone answer', () => {
		setSetting(handle.db, 'leechThreshold', 2);
		seed([basic('a')]);
		bring('a', 'review');
		for (let lapse = 1; lapse <= 2; lapse++) {
			clock.set(getState(handle.db, pk('a'), 0)!.due);
			answer('a', 1);
			bring('a', 'review');
		}
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(true);
		clock.set(getState(handle.db, pk('a'), 0)!.due);
		const answered = answer('a', 1); // a third lapse on a card that is already a leech
		const result = undo(answered.id);
		if (!result.ok) throw new Error('undo failed');
		expect(result.value.leechCleared).toBe(false);
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(true);
	});
});

describe('cloze siblings', () => {
	it('are available again, and only the ones this answer buried', () => {
		seed([cloze('c', 'The {{c1::first}} and the {{c2::second}} and the {{c3::third}}.')]);
		const before = snapshot('c');
		// Cloze items are numbered from 1 (c1 is item 1).
		const answered = answer('c', 3, 1);
		const buried = listStatesForCards(handle.db, [pk('c')]).filter((s) => s.ordinal !== 1);
		expect(buried.map((s) => s.buriedUntil)).toEqual([DAY_END, DAY_END]);

		const result = undo(answered.id);
		if (!result.ok) throw new Error('undo failed');
		expect(result.value.siblingsUnburied).toBe(2);
		expect(snapshot('c')).toEqual(before);
	});

	it('stay buried when the rollover hour changed since the answer (the safe way to be wrong)', () => {
		seed([cloze('c', 'The {{c1::first}} and the {{c2::second}}.')]);
		const answered = answer('c', 3, 1);
		setSetting(handle.db, 'rolloverHour', 6);
		const result = undo(answered.id);
		if (!result.ok) throw new Error('undo failed');
		expect(result.value.siblingsUnburied).toBe(0);
		expect(getState(handle.db, pk('c'), 1)!.reps).toBe(0);
		expect(getState(handle.db, pk('c'), 2)!.buriedUntil).toBe(DAY_END);
	});
});

describe('the guards', () => {
	it('refuses an answer that is not the newest, and allows it once the newer one is undone', () => {
		seed([basic('a'), basic('b')]);
		const first = answer('a', 3);
		clock.advance(MIN);
		const second = answer('b', 3);

		const refused = undo(first.id);
		expect(refused).toMatchObject({ ok: false, error: { code: 'not_latest' } });
		expect(getState(handle.db, pk('a'), 0)!.reps).toBe(1);

		expect(undo(second.id).ok).toBe(true);
		expect(undo(first.id).ok).toBe(true);
		expect(getState(handle.db, pk('a'), 0)!.reps).toBe(0);
	});

	it('refuses when the item was changed after the answer', () => {
		seed([basic('a')]);
		const answered = answer('a', 3);
		updateState(handle.db, pk('a'), 0, { lastReview: '2026-10-10T12:30:00.000Z' });
		expect(undo(answered.id)).toMatchObject({ ok: false, error: { code: 'changed_since' } });
		expect(getReviewLog(handle.db, answered.id)).toBeDefined();
	});

	it('refuses a second undo of the same answer, an unknown id, and a practice row', () => {
		seed([basic('a')]);
		const answered = answer('a', 3);
		expect(undo(answered.id).ok).toBe(true);
		expect(undo(answered.id)).toMatchObject({ ok: false, error: { code: 'not_found' } });
		expect(undo('review-99999999')).toMatchObject({ ok: false, error: { code: 'not_found' } });

		const state = getState(handle.db, pk('a'), 0)!;
		insertReviewLog(handle.db, {
			id: 'practice-00000001',
			cardPk: state.cardPk,
			ordinal: 0,
			mode: 'cram',
			grade: 3,
			preDue: state.due,
			preStability: state.stability,
			preDifficulty: state.difficulty,
			preElapsedDays: state.elapsedDays,
			preScheduledDays: state.scheduledDays,
			preLearningSteps: state.learningSteps,
			preReps: state.reps,
			preLapses: state.lapses,
			prePhase: state.phase,
			preLastReview: state.lastReview,
			result: null,
			scheduledDays: null,
			durationMs: null,
			typedAnswer: null,
			reviewedAt: clock.now().toISOString()
		});
		expect(undo('practice-00000001')).toMatchObject({ ok: false, error: { code: 'not_found' } });
		expect(getReviewLog(handle.db, 'practice-00000001')).toBeDefined();
	});

	it('ignores practice rows when it looks for the newest study answer', () => {
		seed([basic('a')]);
		const answered = answer('a', 3);
		const state = getState(handle.db, pk('a'), 0)!;
		clock.advance(MIN);
		insertReviewLog(handle.db, {
			id: 'practice-00000002',
			cardPk: state.cardPk,
			ordinal: 0,
			mode: 'cram',
			grade: 1,
			preDue: state.due,
			preStability: state.stability,
			preDifficulty: state.difficulty,
			preElapsedDays: state.elapsedDays,
			preScheduledDays: state.scheduledDays,
			preLearningSteps: state.learningSteps,
			preReps: state.reps,
			preLapses: state.lapses,
			prePhase: state.phase,
			preLastReview: state.lastReview,
			result: null,
			scheduledDays: null,
			durationMs: null,
			typedAnswer: null,
			reviewedAt: clock.now().toISOString()
		});
		expect(undo(answered.id).ok).toBe(true);
		expect(getReviewLog(handle.db, 'practice-00000002')).toBeDefined();
	});
});

describe('the numbers counted from the log', () => {
	it('go back: reviews today, the new-card allowance, and the queue counts', () => {
		seed([basic('a'), basic('b')]);
		setSetting(handle.db, 'newPerDay', 1);
		const before = snapshot('a');
		expect(before.reviewsToday).toBe(0);
		expect(before.counts.new).toBe(1);

		const answered = answer('a', 3);
		// A first answer to a card counts against the day's allowance of new cards, not as a review.
		expect(countNewIntroducedSince(handle.db, DAY_START).get('d1')).toBe(1);
		expect(countQueue(handle.db, { scope: {}, now: clock.now(), timeZone: TZ }).new).toBe(0);

		expect(undo(answered.id).ok).toBe(true);
		expect(countNewIntroducedSince(handle.db, DAY_START).get('d1') ?? 0).toBe(0);
		expect(countReviewsSince(handle.db, DAY_START)).toBe(0);
		expect(snapshot('a').counts).toEqual(before.counts);
	});

	it('leave the id free again: a later submit with the same id is a new answer (the accepted edge, ADR-019)', () => {
		seed([basic('a')]);
		const answered = answer('a', 3);
		expect(undo(answered.id).ok).toBe(true);
		const again = submitReview(
			handle.db,
			{
				reviewId: answered.id,
				cardPk: pk('a'),
				ordinal: 0,
				grade: 3,
				servedAt: clock.now().toISOString()
			},
			{ clock, timeZone: TZ }
		);
		expect(again.ok && again.value.replayed).toBe(false);
	});
});
