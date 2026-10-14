import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cards, reviewLog } from '#lib/server/db/schema.ts';
import { moveToTrash } from '#lib/server/decks/index.ts';
import { weakTags } from '#lib/server/leeches/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Weak tags (US-6, ADR-015): per tag, how well it is remembered, from review-phase reviews in the last 90 days, with
// a minimum number of reviews before a tag is ranked at all.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;
const NOW = new Date('2026-10-12T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function seed(id: string, title: string, cardsIn: Record<string, unknown>[]) {
	importForSetup(handle.db, makeDeck(cardsIn, { id, title }), clock);
}

const pkOf = (key: string) => handle.db.select().from(cards).where(eq(cards.key, key)).get()!.pk;

let counter = 0;
// n reviews of a card: `again` of them graded Again, the rest Good.
function reviews(
	key: string,
	n: number,
	again: number,
	options: { prePhase?: number; mode?: 'review' | 'cram'; at?: string } = {}
) {
	for (let i = 0; i < n; i++) {
		handle.db
			.insert(reviewLog)
			.values({
				id: `r-${counter++}`,
				cardPk: pkOf(key),
				ordinal: 0,
				mode: options.mode ?? 'review',
				grade: i < again ? 1 : 3,
				preDue: NOW.toISOString(),
				preStability: 1,
				preDifficulty: 5,
				preElapsedDays: 1,
				preScheduledDays: 1,
				preLearningSteps: 0,
				preReps: 1,
				preLapses: 0,
				prePhase: options.prePhase ?? 2,
				preLastReview: null,
				result: null,
				scheduledDays: null,
				durationMs: 1000,
				typedAnswer: null,
				reviewedAt: options.at ?? ago(5)
			})
			.run();
	}
}

const run = (options: Partial<Parameters<typeof weakTags>[1]> = {}) =>
	weakTags(handle.db, { now: NOW, ...options });

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(NOW);
	handle = openDatabase({ dataDir: dir.path, clock });
	counter = 0;
	seed('net', 'Networking', [
		{ ...basic('o1'), tags: ['ospf'] },
		{ ...basic('o2'), tags: ['ospf'] },
		{ ...basic('s1'), tags: ['stp'] },
		{ ...basic('both'), tags: ['ospf', 'stp'] },
		basic('plain')
	]);
	seed('other', 'Other', [{ ...basic('x1'), tags: ['dns'] }]);
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

describe('weakTags', () => {
	it('is empty when there are no reviews', () => {
		expect(run()).toEqual([]);
	});

	it('gives reviews, retention, lapse rate, and the number of cards for a tag', () => {
		reviews('o1', 10, 4);
		reviews('o2', 10, 1);
		const [row] = run();
		expect(row).toEqual({ tag: 'ospf', reviews: 20, retention: 0.75, lapseRate: 0.25, cards: 2 });
	});

	it('does not rank a tag with fewer than ten reviews', () => {
		reviews('o1', 9, 9);
		expect(run()).toEqual([]);
		reviews('o1', 1, 1);
		expect(run().map((r) => r.tag)).toEqual(['ospf']);
	});

	it('counts a Hard answer as remembered, and only Again as a lapse', () => {
		for (let i = 0; i < 10; i++) {
			handle.db
				.insert(reviewLog)
				.values({
					id: `h-${i}`,
					cardPk: pkOf('o1'),
					ordinal: 0,
					mode: 'review',
					grade: 2,
					preDue: ago(5),
					preStability: 1,
					preDifficulty: 5,
					preElapsedDays: 1,
					preScheduledDays: 1,
					preLearningSteps: 0,
					preReps: 1,
					preLapses: 0,
					prePhase: 2,
					preLastReview: null,
					result: null,
					scheduledDays: null,
					durationMs: 1,
					typedAnswer: null,
					reviewedAt: ago(5)
				})
				.run();
		}
		expect(run()[0]).toMatchObject({ retention: 1, lapseRate: 0 });
	});

	it('ranks the weakest first, then the one with more reviews, then by name', () => {
		reviews('o1', 20, 10); // ospf 50%
		reviews('s1', 12, 6); // stp 50%, fewer reviews
		reviews('x1', 10, 1); // dns 90%
		expect(run().map((r) => r.tag)).toEqual(['ospf', 'stp', 'dns']);
	});

	it('breaks a full tie by name', () => {
		reviews('o1', 10, 5);
		reviews('s1', 10, 5);
		expect(run().map((r) => r.tag)).toEqual(['ospf', 'stp']);
	});

	it('counts a review for every tag its card has', () => {
		reviews('both', 10, 5);
		const rows = run();
		expect(rows.map((r) => [r.tag, r.reviews, r.cards])).toEqual([
			['ospf', 10, 1],
			['stp', 10, 1]
		]);
	});

	it('ignores cards without tags', () => {
		reviews('plain', 30, 30);
		expect(run()).toEqual([]);
	});

	it('uses only review-phase reviews of the review mode', () => {
		reviews('o1', 10, 0);
		reviews('o1', 30, 30, { prePhase: 0 });
		reviews('o1', 30, 30, { prePhase: 1 });
		reviews('o1', 30, 30, { prePhase: 3 });
		reviews('o1', 30, 30, { mode: 'cram' });
		expect(run()[0]).toMatchObject({ reviews: 10, retention: 1 });
	});

	it('looks back 90 days and no further, counting the edge as inside', () => {
		reviews('o1', 10, 0);
		reviews('o1', 10, 10, { at: ago(90) });
		reviews('o1', 10, 10, { at: ago(91) });
		expect(run()[0]).toMatchObject({ reviews: 20, retention: 0.5 });
	});

	it('can use a shorter window', () => {
		reviews('o1', 10, 0, { at: ago(5) });
		reviews('o1', 10, 10, { at: ago(20) });
		expect(run({ windowDays: 7 })[0]).toMatchObject({ reviews: 10, retention: 1 });
	});

	it('leaves out removed cards and decks in the Trash', () => {
		reviews('o1', 10, 5);
		reviews('x1', 10, 5);
		handle.db
			.update(cards)
			.set({ archived: true })
			.where(eq(cards.pk, pkOf('o1')))
			.run();
		moveToTrash(handle.db, 'other', NOW.toISOString());
		expect(run()).toEqual([]);
	});

	it('can be limited to one deck', () => {
		reviews('o1', 10, 5);
		reviews('x1', 10, 5);
		expect(run({ deckId: 'other' }).map((r) => r.tag)).toEqual(['dns']);
		expect(run({ deckId: 'net' }).map((r) => r.tag)).toEqual(['ospf']);
		expect(run({ deckId: 'nope' })).toEqual([]);
	});

	it('reports at most ten tags', () => {
		const deckCards = Array.from({ length: 14 }, (_, i) => ({
			...basic(`t${i}`),
			tags: [`tag${String(i).padStart(2, '0')}`]
		}));
		seed('many', 'Many', deckCards);
		for (let i = 0; i < 14; i++) reviews(`t${i}`, 20, i);
		const rows = run();
		expect(rows).toHaveLength(10);
		// The weakest ten: the ones with the most Again answers, tag13 down to tag04.
		expect(rows[0]!.tag).toBe('tag13');
	});

	it('can be asked for fewer or a different minimum', () => {
		reviews('o1', 4, 4);
		expect(run({ minReviews: 4 }).map((r) => r.tag)).toEqual(['ospf']);
		reviews('s1', 5, 5);
		reviews('x1', 5, 5);
		expect(run({ minReviews: 4, limit: 2 })).toHaveLength(2);
	});
});
