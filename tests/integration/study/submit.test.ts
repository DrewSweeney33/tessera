import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import {
	ReviewInputSchema,
	countQueue,
	selectNext,
	submitReview,
	type ReviewInput,
	type ReviewResult
} from '#lib/server/study/index.ts';
import {
	getCardByKey,
	getReviewLog,
	getState,
	setSetting,
	updateState
} from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

const TZ = 'America/Chicago';
const START = '2026-10-10T12:00:00.000Z'; // 07:00 CDT, study day ends 2026-10-11T09:00Z
const DAY_END = '2026-10-11T09:00:00.000Z';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

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

function seed(cards: Record<string, unknown>[], meta: Record<string, unknown> = {}) {
	seedDeck(handle.db, makeDeck(cards, { id: 'd1', title: 'Deck', ...meta }));
}

function pk(key: string): number {
	return getCardByKey(handle.db, 'd1', key)!.pk;
}

function input(key: string, overrides: Partial<ReviewInput> = {}): ReviewInput {
	return {
		reviewId: `review-${String(++counter).padStart(8, '0')}`,
		cardPk: pk(key),
		ordinal: 0,
		grade: 3,
		servedAt: clock.now().toISOString(),
		...overrides
	};
}

function submit(key: string, overrides: Partial<ReviewInput> = {}): ReviewResult {
	const result = submitReview(handle.db, input(key, overrides), { clock, timeZone: TZ });
	if (!result.ok) throw new Error(`submit failed: ${result.error.code} ${result.error.message}`);
	return result.value;
}

function fail(inputValue: ReviewInput) {
	const result = submitReview(handle.db, inputValue, { clock, timeZone: TZ });
	if (result.ok) throw new Error('expected a failure');
	return result.error;
}

function count(table: string): number {
	return (handle.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

describe('submitReview: recording an answer', () => {
	it('moves a new card into learning and records the full history row', () => {
		seed([basic('a')]);
		const result = submit('a', { durationMs: 2500, typedAnswer: 'show ip route' });

		expect(result).toMatchObject({ replayed: false, grade: 3, becameLeech: false });
		expect(result.next).toMatchObject({ phase: 1, reps: 1, lapses: 0 });
		expect(new Date(result.next.due).getTime() - new Date(START).getTime()).toBe(10 * MIN);

		expect(getState(handle.db, pk('a'), 0)).toMatchObject({
			phase: 1,
			reps: 1,
			due: result.next.due,
			lastReview: START
		});

		const log = getReviewLog(handle.db, result.reviewId)!;
		expect(log).toMatchObject({
			cardPk: pk('a'),
			ordinal: 0,
			mode: 'review',
			grade: 3,
			prePhase: 0,
			preReps: 0,
			preStability: 0,
			preLastReview: null,
			preDue: START,
			scheduledDays: 0,
			durationMs: 2500,
			typedAnswer: 'show ip route',
			reviewedAt: START
		});
		expect(log.result).toEqual(result.next);
	});

	it('walks a card from new to graduated and records each pre-review state', () => {
		seed([basic('a')]);
		const first = submit('a');
		expect(first.next.phase).toBe(1); // first Good lands on the 10 minute step
		clock.set(first.next.due);
		const second = submit('a');
		expect(second.next.phase).toBe(2); // second Good graduates with the default steps
		clock.set(second.next.due);
		const third = submit('a');

		expect(third.next.phase).toBe(2);
		expect(third.next.scheduledDays).toBeGreaterThan(0);
		const logs = handle.sqlite
			.prepare('select pre_phase as p, grade from review_log order by reviewed_at')
			.all() as { p: number; grade: number }[];
		// New, then Learning, then Review: each log row holds the state before that answer.
		expect(logs.map((l) => l.p)).toEqual([0, 1, 2]);
	});

	it('uses the grade given', () => {
		seed([basic('a'), basic('b')]);
		expect(submit('a', { grade: 1 }).next.phase).toBe(1);
		expect(submit('b', { grade: 4 }).next.phase).toBe(2);
	});

	it('honors a per-deck target retention', () => {
		seed([basic('a')], { id: 'd1' });
		seedDeck(handle.db, makeDeck([basic('a')], { id: 'd2', title: 'Other' }));
		handle.sqlite.prepare("update decks set target_retention = 0.75 where id = 'd2'").run();
		const key = (deck: string) => getCardByKey(handle.db, deck, 'a')!.pk;

		const grow = (deck: string) => {
			let result: ReviewResult | undefined;
			for (let i = 0; i < 5; i++) {
				const out = submitReview(
					handle.db,
					{
						reviewId: `grow-${deck}-${i}-xxxxxxxx`,
						cardPk: key(deck),
						ordinal: 0,
						grade: 3,
						servedAt: clock.now().toISOString()
					},
					{ clock, timeZone: TZ }
				);
				if (!out.ok) throw new Error(out.error.message);
				result = out.value;
				clock.set(result.next.due);
			}
			clock.set(START);
			return result!.next.scheduledDays;
		};
		const defaultDays = grow('d1');
		const lowerRetentionDays = grow('d2');
		expect(lowerRetentionDays).toBeGreaterThan(defaultDays);
	});
});

describe('submitReview: idempotence', () => {
	it('returns the stored result for a repeated id and changes nothing', () => {
		seed([basic('a')]);
		const original = input('a');
		const first = submitReview(handle.db, original, { clock, timeZone: TZ });
		const stateAfterFirst = getState(handle.db, pk('a'), 0);

		clock.advance(30 * 1000);
		const replay = submitReview(handle.db, original, { clock, timeZone: TZ });

		expect(first.ok && replay.ok).toBe(true);
		if (!first.ok || !replay.ok) return;
		expect(replay.value.replayed).toBe(true);
		expect(replay.value.next).toEqual(first.value.next);
		expect(replay.value.grade).toBe(first.value.grade);
		expect(getState(handle.db, pk('a'), 0)).toEqual(stateAfterFirst);
		expect(count('review_log')).toBe(1);
	});

	it('does not treat a replay as stale even though the item was reviewed after servedAt', () => {
		seed([basic('a')]);
		const original = input('a', { servedAt: START });
		submitReview(handle.db, original, { clock, timeZone: TZ });
		clock.advance(5 * MIN);
		const replay = submitReview(handle.db, original, { clock, timeZone: TZ });
		expect(replay.ok && replay.value.replayed).toBe(true);
	});

	it('rejects an id reused for a different card', () => {
		seed([basic('a'), basic('b')]);
		const original = input('a');
		submit('a', { reviewId: original.reviewId });
		expect(fail({ ...original, cardPk: pk('b') })).toMatchObject({ code: 'review_id_reused' });
		expect(count('review_log')).toBe(1);
	});
});

describe('submitReview: stale and missing items', () => {
	it('refuses a submission for an item that was reviewed after it was served', () => {
		seed([basic('a')]);
		const servedAt = START;
		clock.advance(MIN);
		submit('a'); // another tab answers at START + 1 minute
		const before = getState(handle.db, pk('a'), 0);

		clock.advance(MIN);
		const stale = fail(input('a', { servedAt }));
		expect(stale.code).toBe('stale_review');
		expect(getState(handle.db, pk('a'), 0)).toEqual(before);
		expect(count('review_log')).toBe(1);
	});

	it('accepts a submission served at exactly the last review time', () => {
		seed([basic('a')]);
		submit('a');
		clock.advance(MIN);
		const lastReview = getState(handle.db, pk('a'), 0)!.lastReview!;
		expect(
			submitReview(handle.db, input('a', { servedAt: lastReview }), { clock, timeZone: TZ }).ok
		).toBe(true);
	});

	it('refuses an unknown card or review item', () => {
		seed([basic('a')]);
		expect(fail(input('a', { cardPk: 9999 }))).toMatchObject({ code: 'not_found' });
		expect(fail(input('a', { ordinal: 5 }))).toMatchObject({ code: 'not_found' });
		expect(count('review_log')).toBe(0);
	});
});

describe('submitReview: cloze siblings', () => {
	it('buries the other items of the same card until the next study day', () => {
		seed([cloze('dr', '{{c1::a}} {{c2::b}} {{c3::c}}')]);
		submit('dr', { ordinal: 1 });
		expect(getState(handle.db, pk('dr'), 1)!.buriedUntil).toBeNull();
		expect(getState(handle.db, pk('dr'), 2)!.buriedUntil).toBe(DAY_END);
		expect(getState(handle.db, pk('dr'), 3)!.buriedUntil).toBe(DAY_END);
	});

	it('does not bury archived siblings or other cards', () => {
		seed([cloze('dr', '{{c1::a}} {{c2::b}}'), basic('other')]);
		handle.sqlite
			.prepare('update card_state set archived = 1 where card_pk = ? and ordinal = 2')
			.run(pk('dr'));
		submit('dr', { ordinal: 1 });
		expect(getState(handle.db, pk('dr'), 2)!.buriedUntil).toBeNull();
		expect(getState(handle.db, pk('other'), 0)!.buriedUntil).toBeNull();
	});

	it('does nothing for cards with a single item', () => {
		seed([basic('a')]);
		submit('a');
		expect(getState(handle.db, pk('a'), 0)!.buriedUntil).toBeNull();
	});

	it('keeps a buried sibling out of the queue today and back in tomorrow', () => {
		seed([cloze('dr', '{{c1::a}} {{c2::b}}')]);
		submit('dr', { ordinal: 1 });
		const queue = (now: Date) =>
			selectNext(handle.db, { scope: {}, now, timeZone: TZ, rng: () => 0 });
		// Ordinal 1 is now in learning (due in 10 minutes). Sibling 2 is new but buried.
		expect(queue(new Date(START)).kind).toBe('item'); // learn-ahead serves ordinal 1
		const served = queue(new Date(START));
		if (served.kind === 'item') expect(served.item.state.ordinal).toBe(1);
		const tomorrow = new Date('2026-10-11T09:00:01.000Z');
		const next = queue(tomorrow);
		expect(next.kind).toBe('item');
	});
});

describe('submitReview: leeches', () => {
	function lapseAgain(key: string) {
		// Make the card a graduated review, then answer Again.
		updateState(handle.db, pk(key), 0, {
			phase: 2,
			stability: 10,
			difficulty: 5,
			reps: 5,
			due: START,
			lastReview: new Date(new Date(START).getTime() - 10 * DAY).toISOString()
		});
		return submit(key, { grade: 1 });
	}

	it('flags the item once, when lapses reach the threshold, and keeps it flagged', () => {
		setSetting(handle.db, 'leechThreshold', 3);
		seed([basic('a')]);
		updateState(handle.db, pk('a'), 0, { lapses: 1 });

		const second = lapseAgain('a'); // lapses 2
		expect(second.next.lapses).toBe(2);
		expect(second).toMatchObject({ becameLeech: false });
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(false);

		clock.advance(MIN);
		const third = lapseAgain('a'); // lapses 3, reaches the threshold
		expect(third).toMatchObject({ becameLeech: true });
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(true);

		clock.advance(MIN);
		const fourth = lapseAgain('a'); // already flagged
		expect(fourth.becameLeech).toBe(false);
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(true);
	});

	it('does not flag on a success, and flags nothing below the default threshold of 8', () => {
		seed([basic('a')]);
		submit('a', { grade: 4 });
		expect(getState(handle.db, pk('a'), 0)!.leech).toBe(false);
		updateState(handle.db, pk('a'), 0, { lapses: 6 });
		const result = lapseAgain('a'); // lapses 7
		expect(result.becameLeech).toBe(false);
	});

	it('does not suspend a leech automatically', () => {
		setSetting(handle.db, 'leechThreshold', 2);
		seed([basic('a')]);
		updateState(handle.db, pk('a'), 0, { lapses: 1 });
		lapseAgain('a');
		expect(getCardByKey(handle.db, 'd1', 'a')!.suspended).toBe(false);
	});
});

describe('submitReview: atomicity', () => {
	it('leaves the schedule unchanged when writing the log fails', () => {
		seed([cloze('dr', '{{c1::a}} {{c2::b}}')]);
		handle.sqlite.exec(
			"create trigger fail_log before insert on review_log begin select raise(abort, 'log write failed'); end"
		);
		const stateBefore = getState(handle.db, pk('dr'), 1);
		const siblingBefore = getState(handle.db, pk('dr'), 2);

		expect(() =>
			submitReview(handle.db, input('dr', { ordinal: 1 }), { clock, timeZone: TZ })
		).toThrow(/log write failed/);

		expect(getState(handle.db, pk('dr'), 1)).toEqual(stateBefore);
		expect(getState(handle.db, pk('dr'), 2)).toEqual(siblingBefore); // not buried
		expect(count('review_log')).toBe(0);

		handle.sqlite.exec('drop trigger fail_log');
		expect(submitReview(handle.db, input('dr', { ordinal: 1 }), { clock, timeZone: TZ }).ok).toBe(
			true
		);
	});
});

describe('submitReview with the queue', () => {
	it('uses up a new card allowance and takes the item out of the queue until it is due', () => {
		seed([basic('a'), basic('b'), basic('c')]);
		setSetting(handle.db, 'newPerDay', 1);
		const counts = () => countQueue(handle.db, { scope: {}, now: clock.now(), timeZone: TZ });
		expect(counts()).toEqual({ learning: 0, review: 0, new: 1 });

		submit('a');
		expect(counts()).toEqual({ learning: 0, review: 0, new: 0 }); // allowance used, a is not due yet

		clock.advance(11 * MIN);
		expect(counts()).toEqual({ learning: 1, review: 0, new: 0 });
		const next = selectNext(handle.db, { scope: {}, now: clock.now(), timeZone: TZ, rng: () => 0 });
		expect(next.kind === 'item' && next.item.card.key).toBe('a');
	});
});

describe('ReviewInputSchema', () => {
	const valid = {
		reviewId: '3f1c0a4e-0d6e-4c7a-9b0e-2b1f4a9d7c10',
		cardPk: 7,
		ordinal: 0,
		grade: 3,
		servedAt: '2026-10-10T12:00:00.000Z'
	};

	it('accepts a minimal and a full submission', () => {
		expect(ReviewInputSchema.safeParse(valid).success).toBe(true);
		expect(
			ReviewInputSchema.safeParse({ ...valid, durationMs: 1500, typedAnswer: 'answer' }).success
		).toBe(true);
	});

	it.each([
		['grade 0', { grade: 0 }],
		['grade 5', { grade: 5 }],
		['grade as a string', { grade: '3' }],
		['short reviewId', { reviewId: 'abc' }],
		['reviewId with spaces', { reviewId: 'not a valid id!' }],
		['non-ISO servedAt', { servedAt: 'yesterday' }],
		['servedAt without zone', { servedAt: '2026-10-10T12:00:00' }],
		['negative duration', { durationMs: -1 }],
		['duration over an hour', { durationMs: 3_600_001 }],
		['zero cardPk', { cardPk: 0 }],
		['fractional ordinal', { ordinal: 1.5 }],
		['huge typed answer', { typedAnswer: 'x'.repeat(2001) }],
		['unknown field', { extra: true }]
	])('rejects %s', (_name, override) => {
		expect(ReviewInputSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});
});
