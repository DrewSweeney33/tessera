import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemRng } from '#lib/server/clock.ts';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { getCardByKey } from '#lib/server/repos/index.ts';
import { buildNext, submitReview } from '#lib/server/study/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The system clock can step backwards: an NTP correction, a VM or laptop resuming from sleep, a
// container host with a drifting clock. A card graded a moment ago must still be answerable.

const TZ = 'America/Chicago';
const START = '2026-10-10T12:00:00.000Z';
const MIN = 60_000;

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(START);
	handle = openDatabase({ dataDir: dir.path, clock });
	seedDeck(handle.db, makeDeck([basic('a')], { id: 'd1', title: 'Deck' }));
	counter = 0;
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

const next = () =>
	buildNext(handle.db, { scope: {}, now: clock.now(), timeZone: TZ, rng: systemRng });

function grade(servedAt: string, cardPk: number) {
	return submitReview(
		handle.db,
		{
			reviewId: `review-${String(++counter).padStart(8, '0')}`,
			cardPk,
			ordinal: 0,
			grade: 3,
			servedAt
		},
		{ clock, timeZone: TZ }
	);
}

describe('clock stepping backwards', () => {
	it('a card graded just before the step can still be answered afterwards', () => {
		const pk = getCardByKey(handle.db, 'd1', 'a')!.pk;
		// First Good on a new card moves it to a 10 minute learning step.
		expect(grade(clock.now().toISOString(), pk).ok).toBe(true);

		// The clock now reads 3 minutes earlier than the moment of that review. The learning card is
		// 13 minutes from due, inside the 20 minute learn-ahead window, so it is offered again.
		clock.set(new Date(Date.parse(START) - 3 * MIN));
		const shown = next();
		expect(shown.done).toBe(false);
		if (shown.done) return;

		const result = grade(shown.item.servedAt, shown.item.cardPk);
		expect(result.ok, JSON.stringify(result)).toBe(true);
	});

	it('still reports a genuinely stale answer when two tabs race with a steady clock', () => {
		const pk = getCardByKey(handle.db, 'd1', 'a')!.pk;
		const first = next();
		const second = next();
		if (first.done || second.done) throw new Error('expected a card');

		clock.advance(5_000);
		expect(grade(first.item.servedAt, pk).ok).toBe(true);
		const late = grade(second.item.servedAt, pk);
		expect(late.ok).toBe(false);
		if (!late.ok) expect(late.error.code).toBe('stale_review');
	});
});
