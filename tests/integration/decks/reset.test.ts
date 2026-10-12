import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cards, cardState, deckResets, decks, reviewLog } from '#lib/server/db/schema.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { deleteDeckForever, moveToTrash, resetDeckProgress } from '#lib/server/decks/index.ts';
import { listSnapshots } from '#lib/server/backups/index.ts';
import { getDeck, listStatesForDeck } from '#lib/server/repos/index.ts';
import { countQueue } from '#lib/server/study/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Start over (US-14, ADR-013): every review item of one deck goes back to a new card. The review history stays, the
// cards and the deck are untouched, a snapshot is taken first, and the title has to be typed.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;

const NOW = '2026-10-12T12:00:00.000Z';
const LATER = '2026-10-20T08:00:00.000Z';

function seed(id: string, title: string, cardsIn: Record<string, unknown>[]) {
	const result = commitImport(
		handle.db,
		makeDeck(cardsIn, { id, title }),
		{ archiveMissing: false, format: 'json' },
		clock
	);
	if (!result.ok) throw new Error('setup import failed');
}

// Makes every item of a deck look well studied, and logs a review for each.
function study(deckId: string) {
	const rows = handle.db.select({ pk: cards.pk }).from(cards).where(eq(cards.deckId, deckId)).all();
	let n = 0;
	for (const { pk } of rows) {
		for (const state of handle.db.select().from(cardState).where(eq(cardState.cardPk, pk)).all()) {
			handle.db
				.update(cardState)
				.set({
					due: '2026-11-30T00:00:00.000Z',
					stability: 12.5,
					difficulty: 6.1,
					elapsedDays: 4,
					scheduledDays: 9,
					learningSteps: 1,
					reps: 5,
					lapses: 2,
					phase: 2,
					lastReview: '2026-10-11T09:00:00.000Z',
					leech: true,
					buriedUntil: '2026-10-13T04:00:00.000Z'
				})
				.where(eq(cardState.cardPk, pk))
				.run();
			handle.db
				.insert(reviewLog)
				.values({
					id: `r-${deckId}-${pk}-${state.ordinal}-${n++}`,
					cardPk: pk,
					ordinal: state.ordinal,
					mode: 'review',
					grade: 3,
					preDue: NOW,
					preStability: 1,
					preDifficulty: 5,
					preElapsedDays: 0,
					preScheduledDays: 0,
					preLearningSteps: 0,
					preReps: 0,
					preLapses: 0,
					prePhase: 0,
					preLastReview: null,
					result: {},
					scheduledDays: 1,
					durationMs: 900,
					typedAnswer: null,
					reviewedAt: NOW
				})
				.run();
		}
	}
}

const context = () => ({
	db: handle.db,
	sqlite: handle.sqlite,
	dataDir: dir.path,
	clock
});

const stateOf = (deckId: string) => listStatesForDeck(handle.db, deckId);
const reviewCount = () => handle.db.select().from(reviewLog).all().length;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(NOW);
	handle = openDatabase({ dataDir: dir.path, clock });
	seed('target', 'Target deck', [
		basic('t1'),
		basic('t2'),
		cloze('t3', 'A {{c1::b}} and {{c2::c}}')
	]);
	seed('other', 'Other deck', [basic('o1'), basic('o2')]);
	study('target');
	study('other');
	clock.set(LATER);
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

describe('resetDeckProgress', () => {
	it('puts every review item of the deck back to a card that was never studied, and says how many', () => {
		const result = resetDeckProgress(context(), 'target', 'Target deck');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({ items: 4, reviews: 4 });

		const states = stateOf('target');
		expect(states).toHaveLength(4);
		for (const state of states) {
			expect(state).toMatchObject({
				due: LATER,
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				reps: 0,
				lapses: 0,
				phase: 0,
				lastReview: null,
				leech: false,
				buriedUntil: null
			});
		}
	});

	it('makes an item exactly like one from a first import, so the scheduler treats it as new', () => {
		resetDeckProgress(context(), 'target', 'Target deck');
		seed('fresh', 'Fresh deck', [basic('f1')]);
		const reset = stateOf('target').find((s) => s.ordinal === 0)!;
		const fresh = stateOf('fresh')[0]!;
		const withoutKey = (row: Record<string, unknown>) =>
			Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'cardPk' && key !== 'due'));
		const resetRest = withoutKey(reset);
		const freshRest = withoutKey(fresh);
		expect(resetRest).toEqual(freshRest);
	});

	it('serves every item as new again', () => {
		expect(
			countQueue(handle.db, { scope: { deckId: 'target' }, now: new Date(LATER), timeZone: 'UTC' })
				.new
		).toBe(0);
		resetDeckProgress(context(), 'target', 'Target deck');
		expect(
			countQueue(handle.db, { scope: { deckId: 'target' }, now: new Date(LATER), timeZone: 'UTC' })
				.new
		).toBe(4);
	});

	it('keeps every review that was logged, and does not touch the cards or the deck', () => {
		const logBefore = handle.db.select().from(reviewLog).all();
		const cardsBefore = handle.db.select().from(cards).all();
		const deckBefore = getDeck(handle.db, 'target');
		resetDeckProgress(context(), 'target', 'Target deck');
		expect(handle.db.select().from(reviewLog).all()).toEqual(logBefore);
		expect(handle.db.select().from(cards).all()).toEqual(cardsBefore);
		expect(getDeck(handle.db, 'target')).toEqual(deckBefore);
	});

	it('leaves every other deck exactly as it was', () => {
		const before = stateOf('other');
		resetDeckProgress(context(), 'target', 'Target deck');
		expect(stateOf('other')).toEqual(before);
	});

	it('keeps an item that was removed from the queue removed', () => {
		const t3 = handle.db.select().from(cards).where(eq(cards.key, 't3')).get()!;
		handle.db.update(cardState).set({ archived: true }).where(eq(cardState.cardPk, t3.pk)).run();
		resetDeckProgress(context(), 'target', 'Target deck');
		const archived = stateOf('target').filter((s) => s.archived);
		expect(archived).toHaveLength(2);
		expect(archived.every((s) => s.phase === 0 && s.reps === 0)).toBe(true);
	});

	it('records the reset, so the history before it can be told from the history after it', () => {
		resetDeckProgress(context(), 'target', 'Target deck');
		const rows = handle.db.select().from(deckResets).where(eq(deckResets.deckId, 'target')).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ deckId: 'target', resetAt: LATER, items: 4 });
		expect(handle.db.select().from(deckResets).where(eq(deckResets.deckId, 'other')).all()).toEqual(
			[]
		);
		clock.advance(1000);
		resetDeckProgress(context(), 'target', 'Target deck');
		expect(
			handle.db.select().from(deckResets).where(eq(deckResets.deckId, 'target')).all()
		).toHaveLength(2);
	});

	it('takes a snapshot first that still has the progress', () => {
		const result = resetDeckProgress(context(), 'target', 'Target deck');
		if (!result.ok) throw new Error('reset failed');
		const { snapshot } = result.value;
		expect(snapshot.kind).toBe('pre-reset');
		expect(snapshot.name).toMatch(/^pre-reset-target-/);
		expect(listSnapshots(dir.path).map((s) => s.name)).toEqual([snapshot.name]);
		const copy = new Database(join(dir.path, 'backups', snapshot.name), { readonly: true });
		try {
			expect(
				copy
					.prepare(
						'select count(*) as n from card_state where reps = 5 and card_pk in (select pk from cards where deck_id = ?)'
					)
					.get('target')
			).toEqual({ n: 4 });
		} finally {
			copy.close();
		}
	});

	it('ignores space around the typed title', () => {
		expect(resetDeckProgress(context(), 'target', '  Target deck ').ok).toBe(true);
	});

	it.each([
		['nothing', ''],
		['the id', 'target'],
		['the wrong case', 'target deck'],
		['part of the title', 'Target'],
		['more than the title', 'Target deck now']
	])('refuses when %s was typed, and changes nothing', (_label, typed) => {
		const before = stateOf('target');
		const result = resetDeckProgress(context(), 'target', typed);
		expect(result).toEqual({ ok: false, error: { kind: 'confirmation_mismatch' } });
		expect(stateOf('target')).toEqual(before);
		expect(handle.db.select().from(deckResets).all()).toEqual([]);
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('refuses an unknown deck, and a deck in the Trash', () => {
		expect(resetDeckProgress(context(), 'nope', 'x')).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
		moveToTrash(handle.db, 'target', LATER);
		const before = stateOf('target');
		expect(resetDeckProgress(context(), 'target', 'Target deck')).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
		expect(stateOf('target')).toEqual(before);
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('does nothing when the snapshot cannot be written (a full disk)', () => {
		const before = stateOf('target');
		const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
		expect(() =>
			resetDeckProgress(context(), 'target', 'Target deck', {
				write: () => {
					throw full;
				}
			})
		).toThrow(full);
		expect(stateOf('target')).toEqual(before);
		expect(handle.db.select().from(deckResets).all()).toEqual([]);
	});

	it('is all or nothing: a failure while recording the reset puts the progress back', () => {
		handle.sqlite.exec(
			"create trigger refuse_reset_row before insert on deck_resets begin select raise(abort, 'refused'); end;"
		);
		const before = stateOf('target');
		expect(() => resetDeckProgress(context(), 'target', 'Target deck')).toThrow(/refused/);
		expect(stateOf('target')).toEqual(before);
		expect(reviewCount()).toBe(6);
		handle.sqlite.exec('drop trigger refuse_reset_row;');
	});

	it('can be done to a deck that was reset before, and to a deck never studied', () => {
		resetDeckProgress(context(), 'target', 'Target deck');
		clock.advance(1000);
		const again = resetDeckProgress(context(), 'target', 'Target deck');
		expect(again.ok).toBe(true);
		seed('virgin', 'Virgin deck', [basic('v1')]);
		const never = resetDeckProgress(context(), 'virgin', 'Virgin deck');
		expect(never.ok && never.value.items).toBe(1);
	});
});

describe('a reset deck and permanent deletion', () => {
	it('deleting a deck for good also removes its record of resets', () => {
		resetDeckProgress(context(), 'target', 'Target deck');
		moveToTrash(handle.db, 'target', LATER);
		const result = deleteDeckForever(context(), 'target', 'Target deck');
		expect(result.ok).toBe(true);
		expect(handle.db.select().from(deckResets).all()).toEqual([]);
		expect(handle.db.select().from(decks).where(eq(decks.id, 'target')).all()).toEqual([]);
	});
});
