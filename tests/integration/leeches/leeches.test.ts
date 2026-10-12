import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cards, cardState, reviewLog } from '#lib/server/db/schema.ts';
import { commitImport } from '#lib/server/import/index.ts';
import {
	countLeeches,
	listLeeches,
	resetLeech,
	setCardSuspended
} from '#lib/server/leeches/index.ts';
import { moveToTrash } from '#lib/server/decks/index.ts';
import { countQueue } from '#lib/server/study/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The leech list and its actions (US-6, ADR-015). A leech is a review item whose flag is set. Reset clears the flag
// and the lapse count and nothing else. Suspend takes the whole card out of the queue and every count.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;
const NOW = '2026-10-12T12:00:00.000Z';

function seed(id: string, title: string, cardsIn: Record<string, unknown>[]) {
	const result = commitImport(
		handle.db,
		makeDeck(cardsIn, { id, title }),
		{ archiveMissing: false, format: 'json' },
		clock
	);
	if (!result.ok) throw new Error('setup import failed');
}

const pkOf = (key: string) => handle.db.select().from(cards).where(eq(cards.key, key)).get()!.pk;

function markLeech(key: string, lapses = 8, ordinal = 0) {
	handle.db
		.update(cardState)
		.set({ leech: true, lapses, reps: lapses + 4, phase: 2, lastReview: NOW })
		.where(and(eq(cardState.cardPk, pkOf(key)), eq(cardState.ordinal, ordinal)))
		.run();
}

let reviewCounter = 0;
function review(key: string, grade: number, typedAnswer: string | null, at: string, ordinal = 0) {
	handle.db
		.insert(reviewLog)
		.values({
			id: `r-${reviewCounter++}`,
			cardPk: pkOf(key),
			ordinal,
			mode: 'review',
			grade,
			preDue: at,
			preStability: 1,
			preDifficulty: 5,
			preElapsedDays: 1,
			preScheduledDays: 1,
			preLearningSteps: 0,
			preReps: 1,
			preLapses: 0,
			prePhase: 2,
			preLastReview: null,
			result: {},
			scheduledDays: 1,
			durationMs: 1000,
			typedAnswer,
			reviewedAt: at
		})
		.run();
}

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(NOW);
	handle = openDatabase({ dataDir: dir.path, clock });
	reviewCounter = 0;
	seed('net', 'Networking', [
		{ ...basic('hello'), tags: ['ospf'] },
		{ id: 'cmd', type: 'typed', front: 'Show routes?', answer: 'show ip route' },
		cloze('timers', 'Hello {{c1::10}} dead {{c2::40}}'),
		basic('fine')
	]);
	seed('other', 'Other', [basic('o1')]);
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

describe('listLeeches', () => {
	it('is empty when nothing is a leech', () => {
		expect(listLeeches(handle.db)).toEqual([]);
		expect(countLeeches(handle.db)).toBe(0);
	});

	it('lists a flagged item with its card, deck, and counts', () => {
		markLeech('hello', 9);
		const [item] = listLeeches(handle.db);
		expect(item).toMatchObject({
			cardPk: pkOf('hello'),
			ordinal: 0,
			deckId: 'net',
			deckTitle: 'Networking',
			key: 'hello',
			type: 'basic',
			lapses: 9,
			reps: 13,
			suspended: false,
			tags: ['ospf']
		});
		expect(item!.content).toMatchObject({ front: 'Q hello', back: 'A hello' });
		expect(item!.lastReviewedAt).toBe(NOW);
	});

	it('lists a cloze blank as its own item, so one card can appear twice', () => {
		markLeech('timers', 8, 1);
		markLeech('timers', 11, 2);
		const items = listLeeches(handle.db);
		expect(items.map((i) => [i.key, i.ordinal, i.lapses])).toEqual([
			['timers', 2, 11],
			['timers', 1, 8]
		]);
	});

	it('puts the worst first: most lapses, then the most recently reviewed, then the id', () => {
		markLeech('hello', 8);
		markLeech('cmd', 12);
		markLeech('fine', 8);
		markLeech('timers', 8, 1);
		const reviewedAt = (key: string, at: string, ordinal = 0) =>
			handle.db
				.update(cardState)
				.set({ lastReview: at })
				.where(and(eq(cardState.cardPk, pkOf(key)), eq(cardState.ordinal, ordinal)))
				.run();
		// 'hello' was reviewed last, so it comes before 'fine' even though 'fine' sorts first by id.
		reviewedAt('hello', '2026-10-13T00:00:00.000Z');
		reviewedAt('fine', '2026-10-12T00:00:00.000Z');
		reviewedAt('timers', '2026-10-12T00:00:00.000Z', 1);
		expect(listLeeches(handle.db).map((i) => i.key)).toEqual(['cmd', 'hello', 'fine', 'timers']);
	});

	it('can be limited to one deck', () => {
		markLeech('hello');
		markLeech('o1');
		expect(listLeeches(handle.db, { deckId: 'other' }).map((i) => i.key)).toEqual(['o1']);
		expect(listLeeches(handle.db, { deckId: 'nope' })).toEqual([]);
	});

	it('leaves out items of removed cards, removed blanks, and decks in the Trash', () => {
		markLeech('hello');
		markLeech('cmd');
		markLeech('o1');
		handle.db
			.update(cards)
			.set({ archived: true })
			.where(eq(cards.pk, pkOf('hello')))
			.run();
		handle.db
			.update(cardState)
			.set({ archived: true })
			.where(eq(cardState.cardPk, pkOf('cmd')))
			.run();
		moveToTrash(handle.db, 'other', NOW);
		expect(listLeeches(handle.db)).toEqual([]);
	});

	it('keeps a suspended card in the list, marked, so it can be put back', () => {
		markLeech('hello');
		setCardSuspended(handle.db, pkOf('hello'), true);
		expect(listLeeches(handle.db)[0]).toMatchObject({ key: 'hello', suspended: true });
	});

	it('counts only leeches that still need attention: not suspended ones', () => {
		markLeech('hello');
		markLeech('cmd');
		setCardSuspended(handle.db, pkOf('cmd'), true);
		expect(countLeeches(handle.db)).toBe(1);
	});

	describe('the wrong answers typed', () => {
		it('are the newest wrong typed answers of this item, at most five, without repeats', () => {
			markLeech('cmd', 10);
			const answers = ['a', 'b', 'c', 'z', 'z', 'y'];
			answers.forEach((a, i) => review('cmd', 1, a, `2026-10-0${i + 1}T10:00:00.000Z`));
			const [item] = listLeeches(handle.db);
			expect(item!.wrongAnswers).toEqual(['y', 'z', 'c', 'b', 'a']);
		});

		it('ignore right answers, reviews without a typed answer, and other items', () => {
			markLeech('cmd', 10);
			review('cmd', 3, 'show ip route', '2026-10-01T10:00:00.000Z');
			review('cmd', 1, null, '2026-10-02T10:00:00.000Z');
			review('cmd', 1, 'wrong one', '2026-10-03T10:00:00.000Z');
			review('hello', 1, 'someone else', '2026-10-04T10:00:00.000Z');
			expect(listLeeches(handle.db)[0]!.wrongAnswers).toEqual(['wrong one']);
		});

		it('are kept apart for the blanks of a cloze card', () => {
			markLeech('timers', 8, 1);
			markLeech('timers', 8, 2);
			review('timers', 1, 'first blank', '2026-10-01T10:00:00.000Z', 1);
			review('timers', 1, 'second blank', '2026-10-02T10:00:00.000Z', 2);
			const items = listLeeches(handle.db);
			expect(items.find((i) => i.ordinal === 1)!.wrongAnswers).toEqual(['first blank']);
			expect(items.find((i) => i.ordinal === 2)!.wrongAnswers).toEqual(['second blank']);
		});

		it('are trimmed, skip blanks, and are cut to 200 characters', () => {
			markLeech('cmd', 10);
			review('cmd', 1, '   ', '2026-10-01T10:00:00.000Z');
			review('cmd', 1, `  ${'x'.repeat(500)}  `, '2026-10-02T10:00:00.000Z');
			const [item] = listLeeches(handle.db);
			expect(item!.wrongAnswers).toHaveLength(1);
			expect(item!.wrongAnswers[0]).toBe('x'.repeat(200));
		});

		it('count a cram review too, since the learner still got it wrong', () => {
			markLeech('cmd', 10);
			handle.db
				.insert(reviewLog)
				.values({
					id: 'cram-1',
					cardPk: pkOf('cmd'),
					ordinal: 0,
					mode: 'cram',
					grade: 1,
					preDue: NOW,
					preStability: 1,
					preDifficulty: 5,
					preElapsedDays: 0,
					preScheduledDays: 0,
					preLearningSteps: 0,
					preReps: 1,
					preLapses: 0,
					prePhase: 2,
					preLastReview: null,
					result: null,
					scheduledDays: null,
					durationMs: 1000,
					typedAnswer: 'cram miss',
					reviewedAt: NOW
				})
				.run();
			expect(listLeeches(handle.db)[0]!.wrongAnswers).toEqual(['cram miss']);
		});
	});
});

describe('resetLeech', () => {
	it('clears the flag and the lapse count, and nothing else', () => {
		markLeech('hello', 9);
		const before = handle.db
			.select()
			.from(cardState)
			.where(eq(cardState.cardPk, pkOf('hello')))
			.get()!;
		expect(resetLeech(handle.db, pkOf('hello'), 0).ok).toBe(true);
		const after = handle.db
			.select()
			.from(cardState)
			.where(eq(cardState.cardPk, pkOf('hello')))
			.get()!;
		expect(after).toEqual({ ...before, leech: false, lapses: 0 });
		expect(listLeeches(handle.db)).toEqual([]);
	});

	it('keeps the review history', () => {
		markLeech('cmd', 9);
		review('cmd', 1, 'x', NOW);
		resetLeech(handle.db, pkOf('cmd'), 0);
		expect(handle.db.select().from(reviewLog).all()).toHaveLength(1);
	});

	it('touches only the item asked for', () => {
		markLeech('timers', 8, 1);
		markLeech('timers', 9, 2);
		resetLeech(handle.db, pkOf('timers'), 1);
		expect(listLeeches(handle.db).map((i) => i.ordinal)).toEqual([2]);
	});

	it('does nothing the second time, and is not an error', () => {
		markLeech('hello', 9);
		expect(resetLeech(handle.db, pkOf('hello'), 0).ok).toBe(true);
		expect(resetLeech(handle.db, pkOf('hello'), 0).ok).toBe(true);
	});

	it('is a not-found for an item that does not exist', () => {
		expect(resetLeech(handle.db, 99999, 0)).toEqual({ ok: false, error: { kind: 'not_found' } });
		expect(resetLeech(handle.db, pkOf('hello'), 7)).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
	});

	it('is a not-found for an item in a deck in the Trash', () => {
		markLeech('o1');
		moveToTrash(handle.db, 'other', NOW);
		expect(resetLeech(handle.db, pkOf('o1'), 0).ok).toBe(false);
	});

	it('works on an item that is not a leech yet: it just sets lapses to zero', () => {
		handle.db
			.update(cardState)
			.set({ lapses: 3 })
			.where(eq(cardState.cardPk, pkOf('fine')))
			.run();
		expect(resetLeech(handle.db, pkOf('fine'), 0).ok).toBe(true);
	});
});

describe('setCardSuspended', () => {
	it('takes the card out of the queue and every count, and putting it back restores it', () => {
		const now = new Date(NOW);
		const count = () => countQueue(handle.db, { scope: { deckId: 'net' }, now, timeZone: 'UTC' });
		const before = count();
		expect(setCardSuspended(handle.db, pkOf('timers'), true).ok).toBe(true);
		// A cloze card has two review items; both go.
		expect(count().new).toBe(before.new - 2);
		expect(setCardSuspended(handle.db, pkOf('timers'), false).ok).toBe(true);
		expect(count()).toEqual(before);
	});

	it('changes nothing about the card or its schedule', () => {
		markLeech('hello', 9);
		const cardBefore = handle.db
			.select()
			.from(cards)
			.where(eq(cards.pk, pkOf('hello')))
			.get()!;
		const stateBefore = handle.db.select().from(cardState).all();
		setCardSuspended(handle.db, pkOf('hello'), true);
		const cardAfter = handle.db
			.select()
			.from(cards)
			.where(eq(cards.pk, pkOf('hello')))
			.get()!;
		expect(cardAfter).toEqual({ ...cardBefore, suspended: true });
		expect(handle.db.select().from(cardState).all()).toEqual(stateBefore);
	});

	it('is idempotent in both directions', () => {
		expect(setCardSuspended(handle.db, pkOf('hello'), true).ok).toBe(true);
		expect(setCardSuspended(handle.db, pkOf('hello'), true).ok).toBe(true);
		expect(setCardSuspended(handle.db, pkOf('hello'), false).ok).toBe(true);
		expect(setCardSuspended(handle.db, pkOf('hello'), false).ok).toBe(true);
	});

	it('is a not-found for an unknown card, a removed card, and a card in a deck in the Trash', () => {
		expect(setCardSuspended(handle.db, 99999, true).ok).toBe(false);
		handle.db
			.update(cards)
			.set({ archived: true })
			.where(eq(cards.pk, pkOf('hello')))
			.run();
		expect(setCardSuspended(handle.db, pkOf('hello'), true).ok).toBe(false);
		moveToTrash(handle.db, 'other', NOW);
		expect(setCardSuspended(handle.db, pkOf('o1'), true).ok).toBe(false);
	});

	it('survives an import that changes the card text, since the card keeps its row', () => {
		setCardSuspended(handle.db, pkOf('hello'), true);
		seed('net', 'Networking', [
			{ ...basic('hello', 'New question', 'New answer') },
			{ id: 'cmd', type: 'typed', front: 'Show routes?', answer: 'show ip route' },
			cloze('timers', 'Hello {{c1::10}} dead {{c2::40}}'),
			basic('fine')
		]);
		expect(
			handle.db
				.select()
				.from(cards)
				.where(eq(cards.pk, pkOf('hello')))
				.get()!.suspended
		).toBe(true);
	});
});
