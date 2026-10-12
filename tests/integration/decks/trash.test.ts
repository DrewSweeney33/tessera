import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cards, cardState, decks, importHistory, reviewLog } from '#lib/server/db/schema.ts';
import { commitImport } from '#lib/server/import/index.ts';
import {
	deleteDeckForever,
	listTrash,
	moveToTrash,
	restoreFromTrash
} from '#lib/server/decks/index.ts';
import { createDeck } from '#lib/server/decks/index.ts';
import { listSnapshots } from '#lib/server/backups/index.ts';
import { getDeck, listDecks } from '#lib/server/repos/index.ts';
import { countQueue } from '#lib/server/study/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The Trash (US-13, ADR-013). Deleting a deck only hides it. Permanent deletion needs the title typed, takes a
// snapshot first, and removes one deck's data and nothing else.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;

const NOW = '2026-10-12T12:00:00.000Z';
const LATER = '2026-10-12T15:30:00.000Z';

function seed(id: string, title: string, cardsIn: Record<string, unknown>[]) {
	const result = commitImport(
		handle.db,
		makeDeck(cardsIn, { id, title }),
		{ archiveMissing: false, format: 'json' },
		clock
	);
	if (!result.ok) throw new Error('setup import failed');
}

// A review on the first item of a deck, so there is history to lose.
function addReview(deckId: string, reviewId: string) {
	const card = handle.db.select().from(cards).where(eq(cards.deckId, deckId)).get()!;
	handle.db
		.insert(reviewLog)
		.values({
			id: reviewId,
			cardPk: card.pk,
			ordinal: 0,
			mode: 'review',
			grade: 3,
			preDue: NOW,
			preStability: 0,
			preDifficulty: 0,
			preElapsedDays: 0,
			preScheduledDays: 0,
			preLearningSteps: 0,
			preReps: 0,
			preLapses: 0,
			prePhase: 0,
			preLastReview: null,
			result: {},
			scheduledDays: 1,
			durationMs: 1000,
			typedAnswer: null,
			reviewedAt: NOW
		})
		.run();
}

const context = () => ({
	db: handle.db,
	sqlite: handle.sqlite,
	dataDir: dir.path,
	clock
});

const counts = (deckId: string) => ({
	cards: handle.db.select().from(cards).where(eq(cards.deckId, deckId)).all().length,
	history: handle.db.select().from(importHistory).where(eq(importHistory.deckId, deckId)).all()
		.length
});

const totalRows = () => ({
	decks: handle.db.select().from(decks).all().length,
	cards: handle.db.select().from(cards).all().length,
	states: handle.db.select().from(cardState).all().length,
	reviews: handle.db.select().from(reviewLog).all().length,
	history: handle.db.select().from(importHistory).all().length
});

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(NOW);
	handle = openDatabase({ dataDir: dir.path, clock });
	seed('keep', 'Keep this', [basic('k1'), basic('k2')]);
	seed('doomed', 'Doomed deck', [basic('d1'), cloze('d2', 'A {{c1::b}} and {{c2::c}}')]);
	addReview('keep', 'r-keep-1');
	addReview('doomed', 'r-doomed-1');
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

describe('moveToTrash and restoreFromTrash', () => {
	it('hides a deck from the list and from every study queue, and keeps everything it holds', () => {
		const before = totalRows();
		const moved = moveToTrash(handle.db, 'doomed', LATER);
		expect(moved.ok).toBe(true);

		expect(listDecks(handle.db).map((d) => d.id)).toEqual(['keep']);
		const queue = countQueue(handle.db, { scope: {}, now: new Date(LATER), timeZone: 'UTC' });
		expect(queue.new).toBe(2);
		expect(
			countQueue(handle.db, { scope: { deckId: 'doomed' }, now: new Date(LATER), timeZone: 'UTC' })
		).toEqual({ new: 0, learning: 0, review: 0 });

		expect(totalRows()).toEqual(before);
		expect(getDeck(handle.db, 'doomed')).toMatchObject({ archived: true, updatedAt: LATER });
	});

	it('restores a deck with its cards, schedule, and history exactly as they were', () => {
		const beforeCards = handle.db.select().from(cards).where(eq(cards.deckId, 'doomed')).all();
		const beforeStates = handle.db.select().from(cardState).all();
		moveToTrash(handle.db, 'doomed', LATER);
		const restored = restoreFromTrash(handle.db, 'doomed', LATER);
		expect(restored.ok).toBe(true);

		expect(listDecks(handle.db).map((d) => d.id)).toEqual(['doomed', 'keep']);
		expect(getDeck(handle.db, 'doomed')).toMatchObject({ archived: false });
		expect(handle.db.select().from(cards).where(eq(cards.deckId, 'doomed')).all()).toEqual(
			beforeCards
		);
		expect(handle.db.select().from(cardState).all()).toEqual(beforeStates);
		expect(
			handle.db.select().from(reviewLog).where(eq(reviewLog.id, 'r-doomed-1')).all()
		).toHaveLength(1);
	});

	it('says there is no such deck for an unknown id, in either direction', () => {
		expect(moveToTrash(handle.db, 'nope', LATER)).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
		expect(restoreFromTrash(handle.db, 'nope', LATER)).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
	});

	it('does nothing the second time: trashing a trashed deck, restoring a live one', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		const again = moveToTrash(handle.db, 'doomed', '2026-10-13T00:00:00.000Z');
		expect(again.ok).toBe(true);
		expect(getDeck(handle.db, 'doomed')?.updatedAt).toBe(LATER);

		const live = restoreFromTrash(handle.db, 'keep', LATER);
		expect(live.ok).toBe(true);
		expect(getDeck(handle.db, 'keep')?.updatedAt).toBe(NOW);
	});

	it('is undone by importing a file for the same deck id, as the guide says, with the history kept', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		seed('doomed', 'Doomed deck', [basic('d1'), cloze('d2', 'A {{c1::b}} and {{c2::c}}')]);
		expect(getDeck(handle.db, 'doomed')?.archived).toBe(false);
		expect(listDecks(handle.db).map((d) => d.id)).toContain('doomed');
		expect(
			handle.db.select().from(reviewLog).where(eq(reviewLog.id, 'r-doomed-1')).all()
		).toHaveLength(1);
	});

	it('keeps the id taken while the deck is in the Trash, so a new deck cannot reuse it', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		const made = createDeck(handle.db, { id: 'doomed', title: 'Another' }, LATER);
		expect(made.ok).toBe(false);
	});
});

describe('listTrash', () => {
	it('lists only decks in the Trash, with what deleting each would remove, newest first', () => {
		seed('later', 'Later deck', [basic('l1')]);
		moveToTrash(handle.db, 'doomed', LATER);
		moveToTrash(handle.db, 'later', '2026-10-12T16:00:00.000Z');

		const trash = listTrash(handle.db);
		expect(trash.map((t) => t.deck.id)).toEqual(['later', 'doomed']);
		expect(trash.find((t) => t.deck.id === 'doomed')).toMatchObject({
			cardCount: 2,
			reviewCount: 1
		});
		expect(trash.find((t) => t.deck.id === 'later')).toMatchObject({
			cardCount: 1,
			reviewCount: 0
		});
	});

	it('is empty when nothing is in the Trash', () => {
		expect(listTrash(handle.db)).toEqual([]);
	});

	it('does not count cards that were removed from the deck as cards in it', () => {
		const card = handle.db.select().from(cards).where(eq(cards.deckId, 'doomed')).all()[0]!;
		handle.db.update(cards).set({ archived: true }).where(eq(cards.pk, card.pk)).run();
		moveToTrash(handle.db, 'doomed', LATER);
		expect(listTrash(handle.db)[0]).toMatchObject({ cardCount: 1 });
	});
});

describe('deleteDeckForever', () => {
	it('refuses a deck that is not in the Trash, and changes nothing', () => {
		const before = totalRows();
		const result = deleteDeckForever(context(), 'doomed', 'Doomed deck');
		expect(result).toEqual({ ok: false, error: { kind: 'not_in_trash' } });
		expect(totalRows()).toEqual(before);
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('refuses an unknown deck', () => {
		expect(deleteDeckForever(context(), 'nope', 'x')).toEqual({
			ok: false,
			error: { kind: 'not_found' }
		});
	});

	it.each([
		['nothing typed', ''],
		['the id instead of the title', 'doomed'],
		['the wrong case', 'doomed deck'],
		['part of the title', 'Doomed'],
		['the title and more', 'Doomed deck please']
	])('refuses when %s was typed, and changes nothing', (_label, typed) => {
		moveToTrash(handle.db, 'doomed', LATER);
		const before = totalRows();
		const result = deleteDeckForever(context(), 'doomed', typed);
		expect(result).toEqual({ ok: false, error: { kind: 'confirmation_mismatch' } });
		expect(totalRows()).toEqual(before);
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('deletes the deck, its cards, schedule, review history, and import history, and nothing of any other deck', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		const keptBefore = {
			cards: handle.db.select().from(cards).where(eq(cards.deckId, 'keep')).all(),
			history: counts('keep').history
		};

		const result = deleteDeckForever(context(), 'doomed', ' Doomed deck ');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({ cards: 2, reviews: 1 });

		expect(getDeck(handle.db, 'doomed')).toBeUndefined();
		expect(counts('doomed')).toEqual({ cards: 0, history: 0 });
		expect(handle.db.select().from(reviewLog).where(eq(reviewLog.id, 'r-doomed-1')).all()).toEqual(
			[]
		);

		expect(getDeck(handle.db, 'keep')).toBeDefined();
		expect(handle.db.select().from(cards).where(eq(cards.deckId, 'keep')).all()).toEqual(
			keptBefore.cards
		);
		expect(counts('keep').history).toBe(keptBefore.history);
		expect(
			handle.db.select().from(reviewLog).where(eq(reviewLog.id, 'r-keep-1')).all()
		).toHaveLength(1);
		// Three schedule rows for the doomed deck (one basic, two cloze numbers) went with it; two stay.
		expect(handle.db.select().from(cardState).all()).toHaveLength(2);
	});

	it('takes a snapshot first, named for the deck, that still holds the deck and its history', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		const result = deleteDeckForever(context(), 'doomed', 'Doomed deck');
		if (!result.ok) throw new Error('delete failed');

		const snapshot = result.value.snapshot;
		expect(snapshot.kind).toBe('pre-delete');
		expect(snapshot.name).toMatch(/^pre-delete-doomed-/);
		expect(listSnapshots(dir.path).map((s) => s.name)).toEqual([snapshot.name]);

		const copy = new Database(join(dir.path, 'backups', snapshot.name), { readonly: true });
		try {
			expect(copy.prepare('select title from decks where id = ?').get('doomed')).toEqual({
				title: 'Doomed deck'
			});
			expect(copy.prepare('select count(*) as n from review_log').get()).toEqual({ n: 2 });
		} finally {
			copy.close();
		}
	});

	it('does not delete anything when the snapshot cannot be written (a full disk)', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		const before = totalRows();
		const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
		expect(() =>
			deleteDeckForever(context(), 'doomed', 'Doomed deck', {
				write: () => {
					throw full;
				}
			})
		).toThrow(full);
		expect(totalRows()).toEqual(before);
		expect(getDeck(handle.db, 'doomed')).toMatchObject({ archived: true });
	});

	it('leaves the id free for a new deck afterwards', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		deleteDeckForever(context(), 'doomed', 'Doomed deck');
		const made = createDeck(handle.db, { id: 'doomed', title: 'Fresh start' }, LATER);
		expect(made.ok).toBe(true);
	});

	it('removes nothing if deleting fails part way (all or nothing)', () => {
		moveToTrash(handle.db, 'doomed', LATER);
		// A trigger that refuses the last step, so the earlier steps must be rolled back with it.
		handle.sqlite.exec(
			"create trigger refuse_deck_delete before delete on decks begin select raise(abort, 'refused'); end;"
		);
		const before = totalRows();
		expect(() => deleteDeckForever(context(), 'doomed', 'Doomed deck')).toThrow(/refused/);
		expect(totalRows()).toEqual(before);
		handle.sqlite.exec('drop trigger refuse_deck_delete;');
	});
});
