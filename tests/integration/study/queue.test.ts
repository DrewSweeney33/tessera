import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import {
	LEARN_AHEAD_MS,
	countQueue,
	selectNext,
	type QueueItem,
	type QueueResult
} from '#lib/server/study/index.ts';
import {
	getCardByKey,
	insertReviewLog,
	setCardsArchived,
	setSetting,
	setStatesArchived,
	updateState
} from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// "now" is 07:00 CDT on 2026-10-10 in Chicago. With a 4am rollover the study day began at
// 09:00Z today and ends at 09:00Z tomorrow.
const TZ = 'America/Chicago';
const NOW = new Date('2026-10-10T12:00:00.000Z');
const DAY_START = '2026-10-10T09:00:00.000Z';
const DAY_END = '2026-10-11T09:00:00.000Z';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let dir: TempDir;
let handle: DatabaseHandle;
let reviewId = 0;

beforeEach(() => {
	dir = makeTempDir();
	handle = openDatabase({ dataDir: dir.path, clock: fakeClock() });
	reviewId = 0;
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => iso(NOW.getTime() - ms);
const ahead = (ms: number) => iso(NOW.getTime() + ms);

function pick(options: { deckId?: string; rng?: () => number; now?: Date } = {}): QueueResult {
	return selectNext(handle.db, {
		scope: options.deckId === undefined ? {} : { deckId: options.deckId },
		now: options.now ?? NOW,
		timeZone: TZ,
		rng: options.rng ?? (() => 0)
	});
}

function served(result: QueueResult): QueueItem {
	if (result.kind !== 'item') throw new Error('expected an item, got an empty queue');
	return result.item;
}

function keyOf(result: QueueResult): string {
	return `${served(result).card.key}:${served(result).state.ordinal}`;
}

function seed(cards: Record<string, unknown>[], deckId = 'd1', title = 'Deck') {
	return seedDeck(handle.db, makeDeck(cards, { id: deckId, title }));
}

// Puts a card into a Review state that was last reviewed `reviewedAgoMs` ago.
function makeReview(
	key: string,
	opts: { stability: number; reviewedAgoMs: number; due: string; ordinal?: number; deckId?: string }
) {
	const pk = getCardByKey(handle.db, opts.deckId ?? 'd1', key)!.pk;
	updateState(handle.db, pk, opts.ordinal ?? 0, {
		phase: 2,
		stability: opts.stability,
		difficulty: 5,
		reps: 4,
		due: opts.due,
		lastReview: ago(opts.reviewedAgoMs),
		scheduledDays: 5
	});
}

function makeLearning(key: string, due: string, phase: 1 | 3 = 1, deckId = 'd1') {
	const pk = getCardByKey(handle.db, deckId, key)!.pk;
	updateState(handle.db, pk, 0, {
		phase,
		due,
		learningSteps: 1,
		reps: 1,
		lastReview: ago(5 * MIN)
	});
}

function logReview(
	key: string,
	opts: {
		prePhase: number;
		at: string;
		mode?: 'review' | 'cram';
		deckId?: string;
		ordinal?: number;
	}
) {
	const pk = getCardByKey(handle.db, opts.deckId ?? 'd1', key)!.pk;
	insertReviewLog(handle.db, {
		id: `log-${++reviewId}`,
		cardPk: pk,
		ordinal: opts.ordinal ?? 0,
		mode: opts.mode ?? 'review',
		grade: 3,
		preDue: opts.at,
		preStability: 0,
		preDifficulty: 0,
		preElapsedDays: 0,
		preScheduledDays: 0,
		preLearningSteps: 0,
		preReps: 0,
		preLapses: 0,
		prePhase: opts.prePhase,
		reviewedAt: opts.at
	});
}

const fiveBasic = () => ['a', 'b', 'c', 'd', 'e'].map((id) => basic(id));

describe('selectNext: an empty or fresh database', () => {
	it('is empty with nothing to wait for', () => {
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	it('serves new cards in file order, one at a time', () => {
		seed(fiveBasic());
		const first = served(pick());
		expect(first.category).toBe('new');
		expect(first.card.key).toBe('a');
		expect(first.state.phase).toBe(0);
	});

	it('orders new cards by deck title first, then file order', () => {
		seed([basic('z1'), basic('z2')], 'zeta', 'Zeta');
		seed([basic('a1'), basic('a2')], 'alpha', 'Alpha');
		expect(keyOf(pick())).toBe('a1:0');
		expect(keyOf(pick({ deckId: 'zeta' }))).toBe('z1:0');
	});
});

describe('selectNext: daily new card limits', () => {
	it('stops offering new cards once the global limit is reached today', () => {
		setSetting(handle.db, 'newPerDay', 2);
		seed(fiveBasic());
		logReview('a', { prePhase: 0, at: ago(60 * MIN) });
		expect(pick().kind).toBe('item');
		logReview('b', { prePhase: 0, at: ago(30 * MIN) });
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	it('applies a per-deck override instead of the global limit', () => {
		seed([basic('a1'), basic('a2')], 'alpha', 'Alpha');
		seed([basic('b1'), basic('b2')], 'beta', 'Beta');
		handle.sqlite.prepare("update decks set new_per_day = 1 where id = 'alpha'").run();
		logReview('a1', { prePhase: 0, at: ago(10 * MIN), deckId: 'alpha' });
		expect(keyOf(pick())).toBe('b1:0');
		expect(pick({ deckId: 'alpha' })).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	it('treats a limit of zero as no new cards for that deck', () => {
		seed(fiveBasic());
		setSetting(handle.db, 'newPerDay', 0);
		expect(pick().kind).toBe('empty');
	});

	it('does not count new cards introduced before today, or cram sessions', () => {
		setSetting(handle.db, 'newPerDay', 1);
		seed(fiveBasic());
		logReview('a', { prePhase: 0, at: iso(new Date(DAY_START).getTime() - MIN) }); // yesterday
		logReview('b', { prePhase: 0, at: ago(10 * MIN), mode: 'cram' });
		expect(pick().kind).toBe('item');
	});

	it('counts only the first review of a card, not its learning repeats', () => {
		setSetting(handle.db, 'newPerDay', 1);
		seed(fiveBasic());
		makeLearning('a', ahead(30 * MIN)); // introduced earlier today and still learning
		logReview('a', { prePhase: 0, at: ago(20 * MIN) });
		logReview('a', { prePhase: 1, at: ago(10 * MIN) });
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: new Date(ahead(30 * MIN)) });
	});
});

describe('selectNext: learning, review, and new priorities', () => {
	it('serves a learning item that is due now before reviews and new cards', () => {
		seed(fiveBasic());
		makeReview('b', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		makeLearning('c', ago(MIN));
		const item = served(pick());
		expect(item.category).toBe('learning');
		expect(item.card.key).toBe('c');
	});

	it('serves reviews before new cards', () => {
		seed(fiveBasic());
		makeReview('d', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		const item = served(pick());
		expect(item.category).toBe('review');
		expect(item.card.key).toBe('d');
	});

	it('serves the review the learner is least likely to remember first', () => {
		seed(fiveBasic());
		// a: 20 days since review with stability 10 (t/S = 2). b: 8 days with stability 6 (t/S = 1.33).
		makeReview('a', { stability: 10, reviewedAgoMs: 20 * DAY, due: ago(1 * DAY) });
		makeReview('b', { stability: 6, reviewedAgoMs: 8 * DAY, due: ago(2 * DAY) });
		expect(keyOf(pick())).toBe('a:0');
		// Reverse the situation and the other card wins, so it is not just ordering by due date.
		makeReview('a', { stability: 40, reviewedAgoMs: 20 * DAY, due: ago(1 * MIN) });
		expect(keyOf(pick())).toBe('b:0');
	});

	it('breaks ties between identical reviews by due time then position', () => {
		seed(fiveBasic());
		for (const key of ['a', 'b', 'c']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		}
		expect(keyOf(pick())).toBe('a:0');
	});
});

describe('selectNext: which reviews are due today', () => {
	it('includes reviews due later today but not after the study day ends', () => {
		seed(fiveBasic());
		makeReview('a', {
			stability: 5,
			reviewedAgoMs: 5 * DAY,
			due: iso(new Date(DAY_END).getTime() - MIN)
		});
		makeReview('b', {
			stability: 5,
			reviewedAgoMs: 5 * DAY,
			due: iso(new Date(DAY_END).getTime() + MIN)
		});
		expect(keyOf(pick())).toBe('a:0');
		makeReview('a', { stability: 5, reviewedAgoMs: 5 * DAY, due: ahead(30 * DAY) });
		// b is due tomorrow, so the only thing left today is new cards.
		expect(served(pick()).category).toBe('new');
	});

	it('respects the daily review limit, which counts graduated reviews only', () => {
		seed(fiveBasic());
		setSetting(handle.db, 'reviewsPerDay', 1);
		makeReview('a', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		makeReview('b', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });

		logReview('c', { prePhase: 1, at: ago(40 * MIN) }); // learning step: not counted
		logReview('c', { prePhase: 3, at: ago(30 * MIN) }); // relearning step: not counted
		logReview('c', { prePhase: 2, at: ago(20 * MIN), mode: 'cram' }); // cram: not counted
		expect(served(pick()).category).toBe('review');

		logReview('c', { prePhase: 2, at: ago(10 * MIN) }); // a real review reaches the limit
		expect(served(pick()).category).toBe('new');
	});

	it('still serves learning items after the review limit is reached', () => {
		seed(fiveBasic());
		setSetting(handle.db, 'reviewsPerDay', 0);
		makeLearning('a', ago(MIN));
		expect(served(pick()).category).toBe('learning');
	});

	it('starts a fresh review allowance at the study day rollover', () => {
		seed(fiveBasic());
		setSetting(handle.db, 'reviewsPerDay', 1);
		makeReview('a', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		logReview('b', { prePhase: 2, at: '2026-10-10T08:59:59.000Z' }); // 03:59:59 CDT, previous study day
		const justAfter = new Date('2026-10-10T09:00:30.000Z');
		expect(served(pick({ now: justAfter })).category).toBe('review');
		logReview('b', { prePhase: 2, at: '2026-10-10T09:00:00.000Z' }); // 04:00 CDT, new study day
		expect(served(pick({ now: justAfter })).category).toBe('new');
	});
});

describe('selectNext: learn ahead', () => {
	it('shows a learning item due within 20 minutes only when nothing else is available', () => {
		seed([basic('a')]);
		makeLearning('a', ahead(15 * MIN));
		const item = served(pick());
		expect(item).toMatchObject({ category: 'learning' });
		expect(item.card.key).toBe('a');
	});

	it('prefers a due review over a learning item that is merely close', () => {
		seed(fiveBasic());
		makeLearning('a', ahead(15 * MIN));
		makeReview('b', { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		expect(keyOf(pick())).toBe('b:0');
	});

	it('prefers new cards over a learning item that is merely close', () => {
		seed([basic('a'), basic('b')]);
		makeLearning('a', ahead(15 * MIN));
		expect(keyOf(pick())).toBe('b:0');
	});

	it('reports when the next learning item is due if it is beyond the learn-ahead window', () => {
		seed([basic('a')]);
		const due = ahead(LEARN_AHEAD_MS + 5 * MIN);
		makeLearning('a', due);
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: new Date(due) });
	});

	it('does not wait for a learning item that is only due after the study day ends', () => {
		seed([basic('a')]);
		makeLearning('a', iso(new Date(DAY_END).getTime() + MIN));
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	it('reports the earliest of several waiting items', () => {
		seed([basic('a'), basic('b')]);
		makeLearning('a', ahead(3 * 60 * MIN));
		makeLearning('b', ahead(90 * MIN));
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: new Date(ahead(90 * MIN)) });
	});
});

describe('selectNext: what is never served', () => {
	beforeEach(() => {
		seed(fiveBasic());
		for (const key of ['a', 'b', 'c', 'd', 'e']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		}
	});

	it('skips suspended and archived cards', () => {
		handle.sqlite.prepare("update cards set suspended = 1 where key = 'a'").run();
		setCardsArchived(handle.db, [getCardByKey(handle.db, 'd1', 'b')!.pk], true, iso(NOW.getTime()));
		expect(keyOf(pick())).toBe('c:0');
	});

	it('skips archived review items and archived decks', () => {
		for (const key of ['a', 'b', 'c', 'd']) {
			setStatesArchived(handle.db, getCardByKey(handle.db, 'd1', key)!.pk, [0], true);
		}
		expect(keyOf(pick())).toBe('e:0');
		handle.sqlite.prepare("update decks set archived = 1 where id = 'd1'").run();
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	it('skips buried items until the burial ends', () => {
		const buryUntil = ahead(2 * 60 * MIN);
		for (const key of ['a', 'b', 'c', 'd']) {
			updateState(handle.db, getCardByKey(handle.db, 'd1', key)!.pk, 0, { buriedUntil: buryUntil });
		}
		expect(keyOf(pick())).toBe('e:0');
		const later = new Date(NOW.getTime() + 3 * 60 * MIN);
		expect(served(pick({ now: later })).category).toBe('review');
		expect(keyOf(pick({ now: later }))).toMatch(/^[a-e]:0$/);
	});

	it('serves sibling cloze items on separate days', () => {
		seed([cloze('dr', '{{c1::a}} {{c2::b}}')], 'cl', 'Cloze');
		const pk = getCardByKey(handle.db, 'cl', 'dr')!.pk;
		for (const ordinal of [1, 2]) {
			updateState(handle.db, pk, ordinal, {
				phase: 2,
				stability: 5,
				reps: 3,
				due: ago(DAY),
				lastReview: ago(6 * DAY)
			});
		}
		for (const key of ['a', 'b', 'c', 'd', 'e']) {
			setCardsArchived(
				handle.db,
				[getCardByKey(handle.db, 'd1', key)!.pk],
				true,
				iso(NOW.getTime())
			);
		}
		updateState(handle.db, pk, 2, { buriedUntil: DAY_END });
		expect(keyOf(pick({ deckId: 'cl' }))).toBe('dr:1');
		updateState(handle.db, pk, 1, { buriedUntil: DAY_END });
		expect(pick({ deckId: 'cl' }).kind).toBe('empty');
	});
});

describe('selectNext: scope', () => {
	it('limits results to one deck when asked', () => {
		seed([basic('a1')], 'alpha', 'Alpha');
		seed([basic('b1')], 'beta', 'Beta');
		expect(keyOf(pick({ deckId: 'beta' }))).toBe('b1:0');
		expect(pick({ deckId: 'missing' }).kind).toBe('empty');
	});
});

describe('selectNext: interleave', () => {
	it('draws due reviews and new cards randomly instead of in order', () => {
		setSetting(handle.db, 'interleave', true);
		seed(fiveBasic());
		for (const key of ['a', 'b', 'c']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		}
		expect(keyOf(pick({ rng: () => 0 }))).toBe('a:0');
		expect(keyOf(pick({ rng: () => 0.5 }))).toBe('b:0');
		expect(keyOf(pick({ rng: () => 0.99 }))).toBe('c:0');

		for (const key of ['a', 'b', 'c']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ahead(30 * DAY) });
		}
		expect(keyOf(pick({ rng: () => 0 }))).toBe('d:0');
		expect(keyOf(pick({ rng: () => 0.99 }))).toBe('e:0');
	});

	it('keeps learning items due now first regardless', () => {
		setSetting(handle.db, 'interleave', true);
		seed(fiveBasic());
		makeLearning('b', ago(MIN));
		expect(keyOf(pick({ rng: () => 0.99 }))).toBe('b:0');
	});
});

// Answers an item the way a real review would: logs it, and moves it far into the future.
function consume(item: QueueItem, now: Date = NOW) {
	logReview(item.card.key, {
		prePhase: item.state.phase,
		at: now.toISOString(),
		deckId: item.card.deckId,
		ordinal: item.state.ordinal
	});
	updateState(handle.db, item.card.pk, item.state.ordinal, {
		phase: 2,
		due: iso(now.getTime() + 60 * DAY),
		lastReview: now.toISOString(),
		stability: 50,
		reps: item.state.reps + 1
	});
}

function drain(options: { deckId?: string; rng?: () => number } = {}): number {
	let served = 0;
	for (let guard = 0; guard < 1000; guard++) {
		const result = pick(options);
		if (result.kind !== 'item') return served;
		served++;
		consume(result.item);
	}
	throw new Error('the queue never drained');
}

describe('countQueue', () => {
	const counts = (scope = {}) => countQueue(handle.db, { scope, now: NOW, timeZone: TZ });

	it('is zero for an empty database', () => {
		expect(counts()).toEqual({ learning: 0, review: 0, new: 0 });
	});

	it('counts learning, review, and new items with the daily limits applied', () => {
		setSetting(handle.db, 'newPerDay', 3);
		setSetting(handle.db, 'reviewsPerDay', 2);
		seed([...fiveBasic(), basic('f'), basic('g')]);
		makeLearning('a', ago(MIN));
		makeLearning('b', ahead(10 * MIN)); // not due yet, so not counted
		for (const key of ['c', 'd', 'e']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		}
		expect(counts()).toEqual({ learning: 1, review: 2, new: 2 }); // f and g only: a to e are not new
	});

	it('reduces the counts by what was already done today', () => {
		setSetting(handle.db, 'newPerDay', 3);
		setSetting(handle.db, 'reviewsPerDay', 5);
		seed([...fiveBasic(), basic('f'), basic('g'), basic('h'), basic('i')]);
		for (const key of ['a', 'b', 'c']) {
			makeReview(key, { stability: 5, reviewedAgoMs: 10 * DAY, due: ago(5 * DAY) });
		}
		logReview('d', { prePhase: 0, at: ago(20 * MIN) });
		logReview('e', { prePhase: 0, at: ago(10 * MIN) });
		logReview('a', { prePhase: 2, at: ago(15 * MIN) });
		logReview('a', { prePhase: 2, at: ago(14 * MIN) });
		logReview('a', { prePhase: 2, at: ago(13 * MIN) });
		logReview('a', { prePhase: 2, at: ago(12 * MIN) });
		// d and e were logged as new introductions but still sit in the New phase in this fixture.
		const result = counts();
		expect(result.review).toBe(1); // limit 5, four done
		expect(result.new).toBe(1); // limit 3 per deck, two introduced
	});

	it('limits new cards per deck and supports a deck scope', () => {
		seed([basic('a1'), basic('a2'), basic('a3')], 'alpha', 'Alpha');
		seed([basic('b1'), basic('b2'), basic('b3')], 'beta', 'Beta');
		handle.sqlite.prepare("update decks set new_per_day = 2 where id = 'alpha'").run();
		expect(counts()).toEqual({ learning: 0, review: 0, new: 5 }); // 2 + 3
		expect(counts({ deckId: 'alpha' }).new).toBe(2);
		expect(counts({ deckId: 'beta' }).new).toBe(3);
		expect(counts({ deckId: 'missing' }).new).toBe(0);
	});

	it('does not count suspended, archived, or buried items', () => {
		seed(fiveBasic());
		handle.sqlite.prepare("update cards set suspended = 1 where key = 'a'").run();
		setCardsArchived(handle.db, [getCardByKey(handle.db, 'd1', 'b')!.pk], true, NOW.toISOString());
		updateState(handle.db, getCardByKey(handle.db, 'd1', 'c')!.pk, 0, { buriedUntil: DAY_END });
		expect(counts().new).toBe(2);
	});
});

describe('countQueue agrees with a real study session', () => {
	it('serves exactly learning + review + new items before the queue is empty', () => {
		setSetting(handle.db, 'newPerDay', 2);
		setSetting(handle.db, 'reviewsPerDay', 3);
		seed([...fiveBasic(), basic('f'), basic('g')], 'alpha', 'Alpha');
		seed([basic('h'), basic('i'), basic('j')], 'beta', 'Beta');
		makeLearning('a', ago(MIN), 1, 'alpha');
		makeLearning('b', ago(2 * MIN), 3, 'alpha');
		for (const key of ['c', 'd', 'e', 'f']) {
			makeReview(key, {
				stability: 5,
				reviewedAgoMs: 10 * DAY,
				due: ago(5 * DAY),
				deckId: 'alpha'
			});
		}
		logReview('g', { prePhase: 0, at: ago(30 * MIN), deckId: 'alpha' });

		const expected = countQueue(handle.db, { scope: {}, now: NOW, timeZone: TZ });
		expect(drain()).toBe(expected.learning + expected.review + expected.new);
		expect(pick()).toEqual({ kind: 'empty', waitingUntil: undefined });
	});

	// Seeded random scenarios: any mix of states, limits, and exclusions must agree.
	function mulberry32(seedValue: number) {
		let a = seedValue;
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const totals: number[] = [];

	for (let seedValue = 1; seedValue <= 25; seedValue++) {
		it(`random scenario ${seedValue}`, () => {
			const r = mulberry32(seedValue * 7919);
			const int = (max: number) => Math.floor(r() * (max + 1));
			setSetting(handle.db, 'newPerDay', int(6));
			setSetting(handle.db, 'reviewsPerDay', int(8));
			setSetting(handle.db, 'interleave', r() < 0.4);

			const deckIds = ['alpha', 'beta', 'gamma'].slice(0, 1 + int(2));
			for (const deckId of deckIds) {
				const cardCount = 1 + int(10);
				seed(
					Array.from({ length: cardCount }, (_, i) => basic(`${deckId}-${i}`)),
					deckId,
					deckId
				);
				if (r() < 0.4) {
					handle.sqlite
						.prepare('update decks set new_per_day = ? where id = ?')
						.run(int(5), deckId);
				}
				for (let i = 0; i < cardCount; i++) {
					const key = `${deckId}-${i}`;
					const kind = int(8);
					if (kind === 1) makeLearning(key, ago(MIN), r() < 0.5 ? 1 : 3, deckId);
					else if (kind === 2) makeLearning(key, ahead(2 * 60 * MIN), 1, deckId);
					else if (kind === 3)
						makeReview(key, {
							stability: 3 + int(30),
							reviewedAgoMs: 6 * DAY,
							due: ago(int(3) * DAY),
							deckId
						});
					else if (kind === 4)
						makeReview(key, { stability: 5, reviewedAgoMs: 2 * DAY, due: ahead(5 * DAY), deckId });
					else if (kind === 5)
						handle.sqlite
							.prepare('update cards set suspended = 1 where deck_id = ? and key = ?')
							.run(deckId, key);
					else if (kind === 6)
						updateState(handle.db, getCardByKey(handle.db, deckId, key)!.pk, 0, {
							buriedUntil: ahead(3 * 60 * MIN)
						});
					else if (kind === 7)
						logReview(key, { prePhase: 0, at: ago((1 + int(50)) * MIN), deckId });
				}
			}

			const expected = countQueue(handle.db, { scope: {}, now: NOW, timeZone: TZ });
			const rng = mulberry32(seedValue);
			const total = expected.learning + expected.review + expected.new;
			totals.push(total);
			expect(drain({ rng })).toBe(total);
		});
	}

	it('the random scenarios exercise real work, not empty queues', () => {
		expect(totals).toHaveLength(25);
		expect(totals.filter((t) => t > 0).length).toBeGreaterThanOrEqual(20);
		expect(Math.max(...totals)).toBeGreaterThanOrEqual(10);
	});
});
