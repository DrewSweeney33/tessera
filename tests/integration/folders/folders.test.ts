import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cards, cardState, decks, folders, reviewLog } from '#lib/server/db/schema.ts';
import { moveToTrash } from '#lib/server/decks/index.ts';
import { exportDeck } from '#lib/server/export/index.ts';
import { planImport } from '#lib/server/import/index.ts';
import {
	assignDecks,
	createFolder,
	deleteFolder,
	folderStats,
	listFolderSummaries,
	renameFolder
} from '#lib/server/folders/index.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { getDeck, getFolder, listDecks, listFolders } from '#lib/server/repos/index.ts';
import { buildNext, countQueue, selectNext, submitReview } from '#lib/server/study/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Project folders: a label that groups decks. A deck is in at most one folder, deleting a folder only ungroups its
// decks, and a session can be limited to a folder. The numbers in a folder's statistics come from the review log
// of the decks inside it.

const TZ = 'America/Chicago';
const START = '2026-10-12T15:00:00.000Z'; // 10 am in Chicago
const MIN = 60_000;
const DAY = 86_400_000;

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(START);
	counter = 0;
	handle = openDatabase({ dataDir: dir.path, clock });
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

const db = () => handle.db;
const nowIso = () => clock.now().toISOString();

function deck(id: string, title: string, count = 2) {
	importForSetup(
		db(),
		makeDeck(
			Array.from({ length: count }, (_, i) => basic(`${id}-${i + 1}`)),
			{ id, title }
		),
		clock
	);
}

function folder(name: string): number {
	const made = createFolder(db(), name, nowIso());
	if (!made.ok) throw new Error(JSON.stringify(made.error));
	return made.value.id;
}

function put(deckIds: string[], folderId: number | null) {
	const moved = assignDecks(db(), deckIds, folderId);
	if (!moved.ok) throw new Error(JSON.stringify(moved.error));
}

const context = () => ({ now: clock.now(), timeZone: TZ });

// Studies one item in a scope the way a session does and answers it.
function answer(
	scope: { deckId?: string; folderId?: number },
	grade: 1 | 2 | 3 | 4,
	durationMs = 1000
) {
	const next = buildNext(db(), { scope, now: clock.now(), timeZone: TZ, rng: () => 0 });
	if (next.done) throw new Error('nothing to study');
	const result = submitReview(
		db(),
		{
			reviewId: `review-${String(++counter).padStart(6, '0')}`,
			cardPk: next.item.cardPk,
			ordinal: next.item.ordinal,
			grade,
			servedAt: next.item.servedAt,
			durationMs
		},
		{ clock, timeZone: TZ }
	);
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return next.item;
}

describe('creating, renaming, and deleting folders', () => {
	it('creates a folder with the name as typed minus the space around it', () => {
		const made = createFolder(db(), '  CCNA 200-301  ', nowIso());
		expect(made.ok && made.value.name).toBe('CCNA 200-301');
		expect(listFolders(db()).map((f) => f.name)).toEqual(['CCNA 200-301']);
	});

	it('refuses a bad name with the reason', () => {
		const empty = createFolder(db(), '   ', nowIso());
		expect(empty).toMatchObject({ ok: false, error: { kind: 'invalid_name', code: 'empty' } });
		const long = createFolder(db(), 'x'.repeat(61), nowIso());
		expect(long).toMatchObject({ ok: false, error: { kind: 'invalid_name', code: 'too_long' } });
		expect(listFolders(db())).toEqual([]);
	});

	it('refuses a second folder with the same name, ignoring case', () => {
		folder('CCNA');
		const again = createFolder(db(), 'ccna', nowIso());
		expect(again).toMatchObject({ ok: false, error: { kind: 'name_taken' } });
		expect(listFolders(db())).toHaveLength(1);
	});

	it('lists folders by name, ignoring case', () => {
		folder('beta');
		folder('Alpha');
		folder('gamma');
		expect(listFolders(db()).map((f) => f.name)).toEqual(['Alpha', 'beta', 'gamma']);
	});

	it('renames a folder, and lets its capitals be fixed', () => {
		const id = folder('ccna');
		expect(renameFolder(db(), id, 'CCNA', nowIso())).toMatchObject({ ok: true });
		expect(getFolder(db(), id)?.name).toBe('CCNA');
		expect(renameFolder(db(), id, ' Networking ', nowIso())).toMatchObject({ ok: true });
		expect(getFolder(db(), id)?.name).toBe('Networking');
	});

	it('does not rename onto another folder name, or a missing folder, or to a bad name', () => {
		const a = folder('A');
		folder('B');
		expect(renameFolder(db(), a, 'b', nowIso())).toMatchObject({
			ok: false,
			error: { kind: 'name_taken' }
		});
		expect(renameFolder(db(), 999, 'Z', nowIso())).toMatchObject({
			ok: false,
			error: { kind: 'not_found' }
		});
		expect(renameFolder(db(), a, '', nowIso())).toMatchObject({
			ok: false,
			error: { kind: 'invalid_name' }
		});
		expect(getFolder(db(), a)?.name).toBe('A');
	});

	it('deletes a folder, ungroups its decks, and deletes nothing else', () => {
		deck('d1', 'D1');
		deck('d2', 'D2');
		const id = folder('Course');
		put(['d1', 'd2'], id);
		answer({ deckId: 'd1' }, 3);
		const cardsBefore = db().select().from(cards).all().length;
		const reviewsBefore = db().select().from(reviewLog).all().length;

		const deleted = deleteFolder(db(), id);
		expect(deleted).toEqual({ ok: true, value: { id, name: 'Course', decks: 2 } });
		expect(listFolders(db())).toEqual([]);
		expect(listDecks(db()).map((d) => [d.id, d.folderId])).toEqual([
			['d1', null],
			['d2', null]
		]);
		expect(db().select().from(cards).all()).toHaveLength(cardsBefore);
		expect(db().select().from(reviewLog).all()).toHaveLength(reviewsBefore);
	});

	it('says not found when the folder is already gone', () => {
		expect(deleteFolder(db(), 42)).toEqual({ ok: false, error: { kind: 'not_found' } });
	});

	it('does not reuse the number of a deleted folder', () => {
		const first = folder('First');
		deleteFolder(db(), first);
		expect(folder('Second')).toBeGreaterThan(first);
	});
});

describe('putting decks in folders', () => {
	it('moves decks in, between folders, and out again', () => {
		deck('d1', 'D1');
		deck('d2', 'D2');
		const a = folder('A');
		const b = folder('B');
		put(['d1', 'd2'], a);
		expect(getDeck(db(), 'd1')?.folderId).toBe(a);
		put(['d2'], b);
		expect(listDecks(db()).map((d) => [d.id, d.folderId])).toEqual([
			['d1', a],
			['d2', b]
		]);
		put(['d1', 'd2'], null);
		expect(listDecks(db()).every((d) => d.folderId === null)).toBe(true);
	});

	it('is all or nothing when a deck or the folder does not exist', () => {
		deck('d1', 'D1');
		const a = folder('A');
		expect(assignDecks(db(), ['d1', 'nope'], a)).toEqual({
			ok: false,
			error: { kind: 'deck_not_found', deckId: 'nope' }
		});
		expect(getDeck(db(), 'd1')?.folderId).toBeNull();
		expect(assignDecks(db(), ['d1'], 999)).toEqual({
			ok: false,
			error: { kind: 'folder_not_found' }
		});
	});

	it('refuses a deck that is in the Trash', () => {
		deck('d1', 'D1');
		const a = folder('A');
		moveToTrash(db(), 'd1', nowIso());
		expect(assignDecks(db(), ['d1'], a)).toMatchObject({ ok: false });
	});

	it('counts a deck once when its id is repeated', () => {
		deck('d1', 'D1');
		const a = folder('A');
		expect(assignDecks(db(), ['d1', 'd1'], a)).toEqual({ ok: true, value: { moved: 1 } });
	});

	it('does not touch the deck itself: its title, cards, revision fields, and history stay', () => {
		deck('d1', 'D1');
		const before = getDeck(db(), 'd1')!;
		put(['d1'], folder('A'));
		const after = getDeck(db(), 'd1')!;
		expect({ ...after, folderId: null }).toEqual(before);
	});

	it('keeps a deck in its folder when the deck is imported again, and when it is trashed and restored', () => {
		deck('d1', 'D1');
		const a = folder('A');
		put(['d1'], a);
		const again = commitImport(
			db(),
			makeDeck([basic('d1-1'), basic('d1-2'), basic('d1-3')], { id: 'd1', title: 'D1 revised' }),
			{ archiveMissing: false, format: 'json' },
			clock
		);
		expect(again.ok).toBe(true);
		expect(getDeck(db(), 'd1')).toMatchObject({ title: 'D1 revised', folderId: a });
		moveToTrash(db(), 'd1', nowIso());
		expect(getDeck(db(), 'd1')?.folderId).toBe(a);
	});

	it('leaves deck files alone: the export is the same in a folder and out, and re-imports as no change', () => {
		deck('d1', 'D1');
		const before = exportDeck(db(), 'd1');
		put(['d1'], folder('A'));
		const after = exportDeck(db(), 'd1');
		expect(after).toEqual(before);
		expect(JSON.stringify(after)).not.toMatch(/folder/i);
		const plan = planImport(db(), after!, { archiveMissing: true });
		expect(plan.ok && plan.value.deck.changed).toBe(false);
		expect(plan.ok && plan.value.counts).toMatchObject({ new: 0, updated: 0 });
	});

	it('puts a deck that is imported for the first time in no folder', () => {
		deck('d1', 'D1');
		expect(getDeck(db(), 'd1')?.folderId).toBeNull();
	});

	it('clears the folder of a deck when the folder row is removed (the foreign key)', () => {
		deck('d1', 'D1');
		const a = folder('A');
		put(['d1'], a);
		db().delete(folders).where(eq(folders.id, a)).run();
		expect(getDeck(db(), 'd1')?.folderId).toBeNull();
	});
});

describe('studying a folder', () => {
	beforeEach(() => {
		deck('ccna-01', 'CCNA 01', 3);
		deck('ccna-02', 'CCNA 02', 3);
		deck('other', 'Other', 3);
	});

	it('serves only items from the decks in the folder, in deck title order', () => {
		const id = folder('CCNA');
		put(['ccna-02', 'ccna-01'], id);
		const seen: string[] = [];
		for (let i = 0; i < 6; i++) {
			seen.push(answer({ folderId: id }, 3).deckId);
		}
		expect(seen).toEqual(['ccna-01', 'ccna-01', 'ccna-01', 'ccna-02', 'ccna-02', 'ccna-02']);
		const rest = selectNext(db(), {
			scope: { folderId: id },
			now: clock.now(),
			timeZone: TZ,
			rng: () => 0
		});
		// Only the six cards of the folder are left, waiting in their learning steps: no new card from outside.
		expect(rest).toMatchObject({ kind: 'item', item: { category: 'learning' } });
		expect(rest.kind === 'item' && ['ccna-01', 'ccna-02'].includes(rest.item.card.deckId)).toBe(
			true
		);
		// The deck outside the folder was never touched.
		expect(
			selectNext(db(), { scope: { deckId: 'other' }, now: clock.now(), timeZone: TZ, rng: () => 0 })
				.kind
		).toBe('item');
	});

	it('counts what a folder session would serve, with the same limits as any session', () => {
		const id = folder('CCNA');
		put(['ccna-01', 'ccna-02'], id);
		expect(countQueue(db(), { scope: { folderId: id }, now: clock.now(), timeZone: TZ })).toEqual({
			learning: 0,
			review: 0,
			new: 6
		});
		expect(countQueue(db(), { scope: {}, now: clock.now(), timeZone: TZ }).new).toBe(9);
		const empty = folder('Empty');
		expect(
			countQueue(db(), { scope: { folderId: empty }, now: clock.now(), timeZone: TZ })
		).toEqual({
			learning: 0,
			review: 0,
			new: 0
		});
	});

	it('applies the per-deck new card limit to each deck in the folder', () => {
		const id = folder('CCNA');
		put(['ccna-01', 'ccna-02'], id);
		db().update(decks).set({ newPerDay: 1 }).where(eq(decks.id, 'ccna-01')).run();
		expect(countQueue(db(), { scope: { folderId: id }, now: clock.now(), timeZone: TZ }).new).toBe(
			4
		);
	});

	it('leaves out suspended cards, removed decks, and decks moved out of the folder', () => {
		const id = folder('CCNA');
		put(['ccna-01', 'ccna-02', 'other'], id);
		const pk = db().select().from(cards).where(eq(cards.deckId, 'ccna-01')).get()!.pk;
		db().update(cards).set({ suspended: true }).where(eq(cards.pk, pk)).run();
		moveToTrash(db(), 'other', nowIso());
		expect(countQueue(db(), { scope: { folderId: id }, now: clock.now(), timeZone: TZ }).new).toBe(
			5
		);
		put(['ccna-02'], null);
		expect(countQueue(db(), { scope: { folderId: id }, now: clock.now(), timeZone: TZ }).new).toBe(
			2
		);
	});

	it('shows the next card with the deck it belongs to', () => {
		const id = folder('CCNA');
		put(['ccna-02'], id);
		const next = buildNext(db(), {
			scope: { folderId: id },
			now: clock.now(),
			timeZone: TZ,
			rng: () => 0
		});
		expect(next).toMatchObject({ done: false, item: { deckId: 'ccna-02', deckTitle: 'CCNA 02' } });
	});
});

describe('folder statistics', () => {
	function setUp() {
		deck('d1', 'D1', 4);
		deck('d2', 'D2', 2);
		deck('out', 'Outside', 3);
		const id = folder('Course');
		put(['d1', 'd2'], id);
		return id;
	}

	it('is all zeros for a folder with no decks or reviews', () => {
		const id = folder('Empty');
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats).toMatchObject({
			folder: { id, name: 'Empty', deckCount: 0, cardCount: 0, reviewsToday: 0, retention: null },
			items: { new: 0, learning: 0, review: 0, suspended: 0 },
			openLeeches: 0,
			reviewsToday: 0,
			reviews7Days: 0,
			reviews30Days: 0,
			timeTodayMs: 0,
			retention7Days: null,
			retention30Days: null,
			streakDays: 0,
			weakTags: []
		});
		expect(stats.days).toHaveLength(14);
		expect(stats.days.every((d) => d.reviews === 0)).toBe(true);
	});

	it('counts decks, cards, and items by where they are in learning', () => {
		const id = setUp();
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.folder).toMatchObject({ deckCount: 2, cardCount: 6, counts: { new: 6 } });
		expect(stats.items).toEqual({ new: 6, learning: 0, review: 0, suspended: 0 });

		answer({ folderId: id }, 3); // a new card becomes learning
		const after = folderStats(db(), getFolder(db(), id)!, context());
		expect(after.items).toEqual({ new: 5, learning: 1, review: 0, suspended: 0 });
	});

	it('counts the blanks of a cloze card as separate items, like the rest of the app', () => {
		importForSetup(
			db(),
			makeDeck([cloze('c1', '{{c1::a}} and {{c2::b}}')], { id: 'cl', title: 'Cloze' }),
			clock
		);
		const id = folder('Course');
		put(['cl'], id);
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.folder.cardCount).toBe(1);
		expect(stats.items.new).toBe(2);
	});

	it('moves suspended cards out of the item counts and into their own', () => {
		const id = setUp();
		const pk = db().select().from(cards).where(eq(cards.deckId, 'd1')).get()!.pk;
		db().update(cards).set({ suspended: true }).where(eq(cards.pk, pk)).run();
		expect(folderStats(db(), getFolder(db(), id)!, context()).items).toEqual({
			new: 5,
			learning: 0,
			review: 0,
			suspended: 1
		});
	});

	it('adds up the reviews of the decks in the folder and none of the others', () => {
		const id = setUp();
		answer({ folderId: id }, 3, 2000);
		answer({ folderId: id }, 1, 4000);
		answer({ deckId: 'out' }, 3, 9000);
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats).toMatchObject({
			reviewsToday: 2,
			reviews7Days: 2,
			reviews30Days: 2,
			timeTodayMs: 6000,
			time7DaysMs: 6000,
			folder: { reviewsToday: 2 }
		});
		expect(stats.days.at(-1)).toMatchObject({ reviews: 2, remembered: 1, timeMs: 6000 });
		expect(stats.streakDays).toBe(1);
	});

	it('measures retention on review-phase reviews only, so a first look at a new card is not counted', () => {
		const id = setUp();
		const first = answer({ folderId: id }, 3); // new card: phase 0, not a retention review
		expect(folderStats(db(), getFolder(db(), id)!, context()).retention30Days).toBeNull();

		// Put that item into the review phase, due now, and review it twice: once remembered, once forgotten.
		db()
			.update(cardState)
			.set({
				phase: 2,
				due: nowIso(),
				stability: 5,
				difficulty: 5,
				reps: 3,
				lastReview: '2026-10-01T12:00:00.000Z'
			})
			.where(eq(cardState.cardPk, first.cardPk))
			.run();
		clock.advance(MIN);
		answer({ deckId: first.deckId }, 3);
		db()
			.update(cardState)
			.set({ phase: 2, due: nowIso() })
			.where(eq(cardState.cardPk, first.cardPk))
			.run();
		clock.advance(MIN);
		answer({ deckId: first.deckId }, 1);

		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.retention30Days).toBe(0.5);
		expect(stats.retention7Days).toBe(0.5);
		expect(stats.folder.retention).toBe(0.5);
		expect(stats.reviewsToday).toBe(3);
	});

	it('does not count practice reviews, and leaves out decks in the Trash', () => {
		const id = setUp();
		const item = answer({ folderId: id }, 3);
		db().update(reviewLog).set({ mode: 'cram' }).where(eq(reviewLog.cardPk, item.cardPk)).run();
		expect(folderStats(db(), getFolder(db(), id)!, context()).reviewsToday).toBe(0);
		db().update(reviewLog).set({ mode: 'review' }).where(eq(reviewLog.cardPk, item.cardPk)).run();
		expect(folderStats(db(), getFolder(db(), id)!, context()).reviewsToday).toBe(1);
		moveToTrash(db(), item.deckId, nowIso());
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.reviewsToday).toBe(0);
		expect(stats.folder.deckCount).toBe(1);
	});

	it('counts reviews today from the start of the study day, not midnight', () => {
		const id = setUp();
		clock.set('2026-10-13T06:30:00.000Z'); // 1:30 am in Chicago: still the 12th's study day
		answer({ folderId: id }, 3);
		clock.set('2026-10-13T08:00:00.000Z'); // 3 am: still the 12th
		expect(folderStats(db(), getFolder(db(), id)!, context()).reviewsToday).toBe(1);
		clock.set('2026-10-13T09:30:00.000Z'); // 4:30 am: the 13th has begun
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.reviewsToday).toBe(0);
		expect(stats.reviews7Days).toBe(1);
		expect(stats.streakDays).toBe(1); // studied on the 12th, the 13th has no review yet
	});

	it('builds a streak across days and breaks it at a gap', () => {
		const id = setUp();
		for (const day of [9, 10, 11, 12]) {
			clock.set(`2026-10-${String(day).padStart(2, '0')}T15:00:00.000Z`);
			answer({ folderId: id }, 3);
		}
		clock.set('2026-10-12T20:00:00.000Z');
		expect(folderStats(db(), getFolder(db(), id)!, context()).streakDays).toBe(4);
		clock.set('2026-10-13T20:00:00.000Z'); // the 13th has no review yet: streak still shown
		expect(folderStats(db(), getFolder(db(), id)!, context()).streakDays).toBe(4);
		clock.set('2026-10-14T20:00:00.000Z'); // a whole day missed
		expect(folderStats(db(), getFolder(db(), id)!, context()).streakDays).toBe(0);
	});

	it('only counts reviews in the windows asked about', () => {
		const id = setUp();
		answer({ folderId: id }, 3); // today
		clock.advance(-10 * DAY);
		answer({ folderId: id }, 3); // ten days ago (the clock only moves back to record it)
		clock.advance(-40 * DAY);
		answer({ folderId: id }, 3); // fifty days ago
		clock.set(START);
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.reviewsToday).toBe(1);
		expect(stats.reviews7Days).toBe(1);
		expect(stats.reviews30Days).toBe(2);
	});

	it('lists the weakest tags among the folder reviews', () => {
		const id = folder('Tagged');
		importForSetup(
			db(),
			makeDeck(
				Array.from({ length: 12 }, (_, i) => ({ ...basic(`t-${i}`), tags: ['ospf'] })),
				{ id: 'tagged', title: 'Tagged' }
			),
			clock
		);
		put(['tagged'], id);
		// Twelve review-phase reviews, all forgotten.
		const states = db().select().from(cardState).all();
		for (const state of states) {
			db()
				.update(cardState)
				.set({
					phase: 2,
					due: nowIso(),
					stability: 4,
					difficulty: 5,
					reps: 3,
					lastReview: '2026-10-01T12:00:00.000Z'
				})
				.where(eq(cardState.cardPk, state.cardPk))
				.run();
		}
		for (let i = 0; i < 12; i++) answer({ folderId: id }, 1);
		const stats = folderStats(db(), getFolder(db(), id)!, context());
		expect(stats.weakTags).toEqual([
			{ tag: 'ospf', reviews: 12, retention: 0, lapseRate: 1, cards: 12 }
		]);
	});

	it('lists every folder with its numbers', () => {
		const id = setUp();
		folder('Empty');
		answer({ folderId: id }, 3);
		const list = listFolderSummaries(db(), context());
		expect(list.map((f) => [f.name, f.deckCount, f.cardCount, f.reviewsToday])).toEqual([
			['Course', 2, 6, 1],
			['Empty', 0, 0, 0]
		]);
	});
});
