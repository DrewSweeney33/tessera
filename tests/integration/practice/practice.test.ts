import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerPractice, currentItem, startPractice } from '#lib/core/practice.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { folderStats } from '#lib/server/folders/index.ts';
import { createLogger } from '#lib/server/log.ts';
import {
	PracticeGradeSchema,
	getPracticeItem,
	poolCounts,
	practicePool,
	recordPractice,
	startPracticeSession
} from '#lib/server/practice/index.ts';
import {
	getCardByKey,
	getFolder,
	getSettings,
	insertFolder,
	setDeckArchived,
	setDecksFolder,
	setSuspended,
	updateState
} from '#lib/server/repos/index.ts';
import { countLeeches, listLeeches, weakTags } from '#lib/server/leeches/index.ts';
import { countQueue, submitReview, type ReviewInput } from '#lib/server/study/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { importForSetup } from '../../helpers/setup-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Practice again (ADR-017): what a session can show, and the promise that it never changes a schedule or any number
// the study side shows.

const TZ = 'America/Chicago';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let dir: TempDir;
let app: AppContext;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock('2026-10-12T15:00:00.000Z');
	const config = parseConfig({ DATA_DIR: dir.path, TZ });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		rng: () => 0.5,
		log: createLogger({ level: 'error', write: () => {} })
	});
	counter = 0;
	importForSetup(
		app.db,
		makeDeck(
			[basic('a1'), basic('a2'), basic('a3'), cloze('a4', 'The {{c1::sky}} is {{c2::blue}}')],
			{
				id: 'alpha',
				title: 'Alpha deck'
			}
		),
		clock
	);
	importForSetup(
		app.db,
		makeDeck([basic('b1'), basic('b2')], { id: 'beta', title: 'Beta deck' }),
		clock
	);
	importForSetup(app.db, makeDeck([basic('c1')], { id: 'gamma', title: 'Gamma deck' }), clock);
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const pk = (deckId: string, key: string) => getCardByKey(app.db, deckId, key)!.pk;
const sqlite = () => app.database.sqlite;

function study(deckId: string, key: string, grade: ReviewInput['grade'], ordinal = 0) {
	const result = submitReview(
		app.db,
		{
			reviewId: `review-${String(++counter).padStart(8, '0')}`,
			cardPk: pk(deckId, key),
			ordinal,
			grade,
			servedAt: clock.now().toISOString(),
			durationMs: 1200
		},
		{ clock, timeZone: TZ }
	);
	if (!result.ok) throw new Error(`study failed: ${result.error.code}`);
	return result.value;
}

function practice(deckId: string, key: string, right: boolean, ordinal = 0, id?: string) {
	return recordPractice(
		app.db,
		{
			reviewId: id ?? `practice-${String(++counter).padStart(8, '0')}`,
			cardPk: pk(deckId, key),
			ordinal,
			right,
			durationMs: 900
		},
		{ clock }
	);
}

function rows(table: string): unknown[] {
	return sqlite().prepare(`select * from ${table} order by 1, 2`).all();
}

const count = (table: string, where = '1=1') =>
	(sqlite().prepare(`select count(*) as n from ${table} where ${where}`).get() as { n: number }).n;

function refKeys(items: { cardPk: number; ordinal: number }[]) {
	return items.map((entry) => `${entry.cardPk}:${entry.ordinal}`);
}

describe('the pool', () => {
	it('is every active item in a deck, new ones included, with a cloze card as one item per blank', () => {
		const pool = practicePool(app.db, { deckId: 'alpha' }, clock.now());
		expect(refKeys(pool)).toEqual([
			`${pk('alpha', 'a1')}:0`,
			`${pk('alpha', 'a2')}:0`,
			`${pk('alpha', 'a3')}:0`,
			`${pk('alpha', 'a4')}:1`,
			`${pk('alpha', 'a4')}:2`
		]);
		expect(pool.every((entry) => entry.retrievability === null)).toBe(true);
		expect(poolCounts(app.db, { deckId: 'alpha' }, clock.now())).toEqual({
			total: 5,
			unstudied: 5
		});
	});

	it('covers every deck in a folder and nothing outside it', () => {
		const folder = insertFolder(app.db, 'Course', clock.now().toISOString());
		setDecksFolder(app.db, ['alpha', 'beta'], folder.id);
		const pool = practicePool(app.db, { folderId: folder.id }, clock.now());
		expect(pool).toHaveLength(7);
		expect(pool.some((entry) => entry.cardPk === pk('gamma', 'c1'))).toBe(false);
	});

	it('ignores due dates and burying', () => {
		study('alpha', 'a4', 3, 1); // buries the sibling blank until the next study day
		const sibling = getCardByKey(app.db, 'alpha', 'a4')!;
		expect(
			countQueue(app.db, { scope: { deckId: 'alpha' }, now: clock.now(), timeZone: TZ }).new
		).toBe(3); // a1 to a3; the buried blank is not served
		const pool = practicePool(app.db, { deckId: 'alpha' }, clock.now());
		expect(refKeys(pool)).toContain(`${sibling.pk}:2`);
		expect(pool).toHaveLength(5);
	});

	it('leaves out suspended cards, removed cards and items, and decks in the Trash', () => {
		setSuspended(app.db, pk('alpha', 'a1'), true);
		sqlite().prepare('update cards set archived = 1 where pk = ?').run(pk('alpha', 'a2'));
		sqlite()
			.prepare('update card_state set archived = 1 where card_pk = ? and ordinal = 2')
			.run(pk('alpha', 'a4'));
		const pool = practicePool(app.db, { deckId: 'alpha' }, clock.now());
		expect(refKeys(pool)).toEqual([`${pk('alpha', 'a3')}:0`, `${pk('alpha', 'a4')}:1`]);

		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(practicePool(app.db, { deckId: 'beta' }, clock.now())).toEqual([]);
		const folder = insertFolder(app.db, 'Course', clock.now().toISOString());
		setDecksFolder(app.db, ['beta', 'gamma'], folder.id);
		expect(practicePool(app.db, { folderId: folder.id }, clock.now())).toHaveLength(1);
	});

	it('measures studied items by how likely they are to be remembered now', () => {
		study('alpha', 'a1', 3);
		clock.advance(30 * DAY);
		const pool = practicePool(app.db, { deckId: 'alpha' }, clock.now());
		const studied = pool.find((entry) => entry.cardPk === pk('alpha', 'a1'))!;
		expect(studied.retrievability).toBeGreaterThan(0);
		expect(studied.retrievability).toBeLessThan(1);
		expect(poolCounts(app.db, { deckId: 'alpha' }, clock.now()).unstudied).toBe(4);
	});
});

describe('a tag as the scope (ADR-020)', () => {
	function tagCards(tag: string, ...cards: [string, string][]) {
		for (const [deckId, key] of cards) {
			const row = sqlite().prepare('select tags from cards where pk = ?').get(pk(deckId, key)) as {
				tags: string;
			};
			const tags = [...(JSON.parse(row.tags) as string[]), tag];
			sqlite()
				.prepare('update cards set tags = ? where pk = ?')
				.run(JSON.stringify(tags), pk(deckId, key));
		}
	}
	const poolFor = (tag: string) => practicePool(app.db, { tag }, clock.now());

	beforeEach(() => {
		tagCards('net', ['alpha', 'a1'], ['alpha', 'a2'], ['beta', 'b1']);
		tagCards('sec', ['alpha', 'a3'], ['beta', 'b1']);
		tagCards('cloze tag', ['alpha', 'a4']);
	});

	it('is every active item that carries the tag, in any deck', () => {
		expect(refKeys(poolFor('net'))).toEqual(
			[pk('alpha', 'a1'), pk('alpha', 'a2'), pk('beta', 'b1')].map((cardPk) => `${cardPk}:0`)
		);
		expect(refKeys(poolFor('sec'))).toEqual(
			[pk('alpha', 'a3'), pk('beta', 'b1')].map((cardPk) => `${cardPk}:0`)
		);
	});

	it('counts a cloze card as one item per blank, like a deck does', () => {
		expect(poolFor('cloze tag')).toHaveLength(2);
	});

	it('matches the tag exactly as stored: not a part of it, not another case, not an empty one', () => {
		for (const tag of ['ne', 'nett', 'Net', 'NET', 'cloze', ' net', 'net ', '']) {
			expect(poolFor(tag), JSON.stringify(tag)).toEqual([]);
		}
	});

	it('finds nothing for a tag no card has, and treats a hostile tag as plain text', () => {
		expect(poolFor('no-such-tag')).toEqual([]);
		for (const tag of ["net' or '1'='1", 'net") or 1=1 --', '%', '_', 'net\\', "a'b", '<script>']) {
			expect(poolFor(tag), tag).toEqual([]);
		}
		// A tag with quotes in it is still found when a card really has it.
		tagCards("it's (v2)", ['gamma', 'c1']);
		expect(refKeys(poolFor("it's (v2)"))).toEqual([`${pk('gamma', 'c1')}:0`]);
	});

	it('leaves out suspended and removed cards and decks in the Trash, like every other scope', () => {
		setSuspended(app.db, pk('alpha', 'a1'), true);
		sqlite().prepare('update cards set archived = 1 where pk = ?').run(pk('alpha', 'a2'));
		expect(refKeys(poolFor('net'))).toEqual([`${pk('beta', 'b1')}:0`]);
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(poolFor('net')).toEqual([]);
	});

	it('starts a session, counts the pool, and orders it like the other scopes', () => {
		const started = startPracticeSession(
			app.db,
			{ scope: { tag: 'net' }, count: 2, order: 'shuffle' },
			{ now: clock.now(), rng: () => 0.2 }
		);
		expect(started.poolSize).toBe(3);
		expect(started.items).toHaveLength(2);
		expect(poolCounts(app.db, { tag: 'net' }, clock.now())).toEqual({ total: 3, unstudied: 3 });
	});

	it('changes nothing in the database, answers included (the schedule promise holds for a tag)', () => {
		study('alpha', 'a1', 3);
		clock.advance(DAY);
		const before = {
			cardState: rows('card_state'),
			cards: rows('cards'),
			decks: rows('decks'),
			settings: getSettings(app.db),
			reviews: sqlite().prepare("select * from review_log where mode = 'review'").all(),
			queue: countQueue(app.db, { scope: {}, now: clock.now(), timeZone: TZ })
		};
		const pool = startPracticeSession(
			app.db,
			{ scope: { tag: 'net' }, count: 'all', order: 'weakest' },
			{ now: clock.now(), rng: () => 0.3 }
		).items;
		let session = startPractice(pool);
		let turn = 0;
		while (currentItem(session) && turn < 100) {
			const item = currentItem(session)!;
			const right = ++turn % 2 === 0;
			expect(
				recordPractice(
					app.db,
					{
						reviewId: `practice-tag-${String(turn).padStart(6, '0')}`,
						cardPk: item.cardPk,
						ordinal: item.ordinal,
						right
					},
					{ clock }
				).ok
			).toBe(true);
			session = answerPractice(session, right);
		}
		expect(turn).toBeGreaterThanOrEqual(3);
		expect(rows('card_state')).toEqual(before.cardState);
		expect(rows('cards')).toEqual(before.cards);
		expect(rows('decks')).toEqual(before.decks);
		expect(getSettings(app.db)).toEqual(before.settings);
		expect(sqlite().prepare("select * from review_log where mode = 'review'").all()).toEqual(
			before.reviews
		);
		expect(countQueue(app.db, { scope: {}, now: clock.now(), timeZone: TZ })).toEqual(before.queue);
	});
});

describe('starting a session', () => {
	const context = () => ({ now: clock.now(), rng: () => 0.5 });

	it('returns the ordered references, cut to the count, with the pool size', () => {
		const all = startPracticeSession(
			app.db,
			{ scope: { deckId: 'alpha' }, count: 'all', order: 'shuffle' },
			context()
		);
		expect(all.poolSize).toBe(5);
		expect(all.items).toHaveLength(5);
		const cut = startPracticeSession(
			app.db,
			{ scope: { deckId: 'alpha' }, count: 2, order: 'shuffle' },
			context()
		);
		expect(cut.items).toHaveLength(2);
		expect(cut.poolSize).toBe(5);
	});

	it('puts the weakest studied item first and the never studied last', () => {
		study('alpha', 'a1', 3);
		clock.advance(5 * DAY);
		study('alpha', 'a2', 3);
		clock.advance(3 * DAY);
		const started = startPracticeSession(
			app.db,
			{ scope: { deckId: 'alpha' }, count: 'all', order: 'weakest' },
			context()
		);
		expect(refKeys(started.items).slice(0, 2)).toEqual([
			`${pk('alpha', 'a1')}:0`,
			`${pk('alpha', 'a2')}:0`
		]);
		expect(started.items).toHaveLength(5);
	});

	it('is empty, not an error, when there is nothing to practice', () => {
		setDeckArchived(app.db, 'gamma', true, clock.now().toISOString());
		expect(
			startPracticeSession(
				app.db,
				{ scope: { deckId: 'gamma' }, count: 'all', order: 'shuffle' },
				context()
			)
		).toEqual({ items: [], poolSize: 0 });
	});

	it('changes nothing in the database', () => {
		const before = { state: rows('card_state'), log: rows('review_log') };
		startPracticeSession(
			app.db,
			{ scope: { deckId: 'alpha' }, count: 'all', order: 'weakest' },
			context()
		);
		expect({ state: rows('card_state'), log: rows('review_log') }).toEqual(before);
	});
});

describe('one item', () => {
	it('is shaped like a study item without the schedule parts', () => {
		const item = getPracticeItem(app.db, pk('alpha', 'a1'), 0)!;
		expect(item).toMatchObject({
			cardPk: pk('alpha', 'a1'),
			ordinal: 0,
			deckId: 'alpha',
			deckTitle: 'Alpha deck',
			key: 'a1',
			type: 'basic'
		});
		expect(item.state.reps).toBe(0);
		expect(item).not.toHaveProperty('previews');
		expect(item).not.toHaveProperty('servedAt');
		expect(item).not.toHaveProperty('category');
	});

	it('is refused for what practice may not show', () => {
		expect(getPracticeItem(app.db, 999_999, 0)).toBeUndefined();
		expect(getPracticeItem(app.db, pk('alpha', 'a1'), 7)).toBeUndefined();
		setSuspended(app.db, pk('alpha', 'a1'), true);
		expect(getPracticeItem(app.db, pk('alpha', 'a1'), 0)).toBeUndefined();
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(getPracticeItem(app.db, pk('beta', 'b1'), 0)).toBeUndefined();
	});
});

describe('recording an answer', () => {
	it('adds one log row in mode cram, grade 3 for right and 1 for missed, with the state at that moment', () => {
		study('alpha', 'a1', 3);
		clock.advance(2 * DAY);
		const before = sqlite()
			.prepare('select * from card_state where card_pk = ? and ordinal = 0')
			.get(pk('alpha', 'a1')) as Record<string, unknown>;

		expect(practice('alpha', 'a1', true, 0, 'practice-right-1').ok).toBe(true);
		expect(practice('alpha', 'a1', false, 0, 'practice-miss-1').ok).toBe(true);

		const right = sqlite()
			.prepare('select * from review_log where id = ?')
			.get('practice-right-1') as Record<string, unknown>;
		const miss = sqlite()
			.prepare('select * from review_log where id = ?')
			.get('practice-miss-1') as Record<string, unknown>;
		expect(right).toMatchObject({
			mode: 'cram',
			grade: 3,
			result: null,
			scheduled_days: null,
			duration_ms: 900,
			reviewed_at: clock.now().toISOString(),
			pre_due: before['due'],
			pre_stability: before['stability'],
			pre_reps: before['reps'],
			pre_phase: before['phase']
		});
		expect(miss).toMatchObject({ mode: 'cram', grade: 1 });
		expect(count('review_log', "mode = 'cram'")).toBe(2);
	});

	it('keeps a typed answer', () => {
		const result = recordPractice(
			app.db,
			{
				reviewId: 'practice-typed-1',
				cardPk: pk('alpha', 'a1'),
				ordinal: 0,
				right: false,
				typedAnswer: 'my guess'
			},
			{ clock }
		);
		expect(result.ok).toBe(true);
		expect(
			(
				sqlite()
					.prepare('select typed_answer from review_log where id = ?')
					.get('practice-typed-1') as { typed_answer: string }
			).typed_answer
		).toBe('my guess');
	});

	it('is idempotent: the same id and item is a replay, with no second row', () => {
		const first = practice('alpha', 'a1', true, 0, 'practice-dup-1');
		const again = practice('alpha', 'a1', true, 0, 'practice-dup-1');
		expect(first).toEqual({ ok: true, value: { replayed: false } });
		expect(again).toEqual({ ok: true, value: { replayed: true } });
		expect(count('review_log')).toBe(1);
	});

	it('refuses an id used for another item, or for a real review', () => {
		practice('alpha', 'a1', true, 0, 'practice-dup-2');
		const other = practice('alpha', 'a2', true, 0, 'practice-dup-2');
		expect(other).toMatchObject({ ok: false, error: { code: 'review_id_reused' } });

		const reviewed = study('alpha', 'a3', 3);
		const asPractice = recordPractice(
			app.db,
			{ reviewId: reviewed.reviewId, cardPk: pk('alpha', 'a3'), ordinal: 0, right: true },
			{ clock }
		);
		expect(asPractice).toMatchObject({ ok: false, error: { code: 'review_id_reused' } });
		expect(count('review_log')).toBe(2);
	});

	it('does not let a practice row be replayed as a study review', () => {
		practice('alpha', 'a1', true, 0, 'practice-dup-3');
		const result = submitReview(
			app.db,
			{
				reviewId: 'practice-dup-3',
				cardPk: pk('alpha', 'a1'),
				ordinal: 0,
				grade: 3,
				servedAt: clock.now().toISOString()
			},
			{ clock, timeZone: TZ }
		);
		expect(result).toMatchObject({ ok: false, error: { code: 'review_id_reused' } });
		expect(rows('card_state').length).toBeGreaterThan(0);
		expect(count('review_log', "mode = 'review'")).toBe(0);
	});

	it('refuses an item that cannot be practiced, and writes nothing', () => {
		setSuspended(app.db, pk('alpha', 'a1'), true);
		expect(practice('alpha', 'a1', true)).toMatchObject({
			ok: false,
			error: { code: 'not_found' }
		});
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(practice('beta', 'b1', true)).toMatchObject({ ok: false, error: { code: 'not_found' } });
		expect(
			recordPractice(
				app.db,
				{ reviewId: 'practice-none-1', cardPk: 999_999, ordinal: 0, right: true },
				{ clock }
			)
		).toMatchObject({ ok: false, error: { code: 'not_found' } });
		expect(count('review_log')).toBe(0);
	});

	it('is validated: strict fields, a bounded id, a real boolean', () => {
		const ok = { reviewId: 'practice-ok-001', cardPk: 1, ordinal: 0, right: true };
		expect(PracticeGradeSchema.safeParse(ok).success).toBe(true);
		for (const bad of [
			{ ...ok, extra: 1 },
			{ ...ok, right: 1 },
			{ ...ok, right: 'true' },
			{ ...ok, reviewId: 'short' },
			{ ...ok, reviewId: 'has spaces here' },
			{ ...ok, cardPk: 0 },
			{ ...ok, ordinal: 100 },
			{ ...ok, durationMs: -1 },
			{ ...ok, typedAnswer: 'x'.repeat(2001) },
			{ reviewId: ok.reviewId, cardPk: 1, ordinal: 0 }
		]) {
			expect(PracticeGradeSchema.safeParse(bad).success).toBe(false);
		}
	});
});

// The promise of ADR-017. Everything the study side reads is captured before a practice session and after it.
describe('practice never changes a schedule or a study number', () => {
	function worldOfStudy() {
		const folder = getFolder(app.db, 1)!;
		const now = clock.now();
		return {
			cardState: rows('card_state'),
			cards: rows('cards'),
			decks: rows('decks'),
			folders: rows('folders'),
			settings: getSettings(app.db),
			reviewRows: sqlite()
				.prepare("select * from review_log where mode = 'review' order by id")
				.all(),
			queueAll: countQueue(app.db, { scope: {}, now, timeZone: TZ }),
			queueAlpha: countQueue(app.db, { scope: { deckId: 'alpha' }, now, timeZone: TZ }),
			queueFolder: countQueue(app.db, { scope: { folderId: folder.id }, now, timeZone: TZ }),
			folder: folderStats(app.db, folder, { now, timeZone: TZ }),
			leeches: listLeeches(app.db),
			leechCount: countLeeches(app.db),
			weakTags: weakTags(app.db, { now, minReviews: 1 })
		};
	}

	beforeEach(() => {
		insertFolder(app.db, 'Course', clock.now().toISOString());
		setDecksFolder(app.db, ['alpha', 'beta'], 1);
		// A realistic history: cards in every phase, one failed often enough to be a leech, tags for weak tags.
		sqlite().prepare("update cards set tags = '[\"net\"]' where deck_id = 'alpha'").run();
		study('alpha', 'a1', 3);
		clock.advance(3 * DAY);
		study('alpha', 'a1', 3);
		study('alpha', 'a2', 1);
		study('alpha', 'a2', 3);
		study('alpha', 'a3', 4);
		study('beta', 'b1', 1);
		clock.advance(40 * MIN);
		study('beta', 'b1', 2);
		updateState(app.db, pk('beta', 'b1'), 0, { lapses: 9, leech: true });
		clock.advance(DAY);
	});

	it('leaves card_state, cards, decks, folders, and settings exactly as they were', () => {
		const before = worldOfStudy();
		expect(before.leechCount).toBeGreaterThan(0);
		const logBefore = count('review_log');

		const pool = startPracticeSession(
			app.db,
			{ scope: { folderId: 1 }, count: 'all', order: 'weakest' },
			{ now: clock.now(), rng: () => 0.3 }
		).items;
		expect(pool.length).toBeGreaterThan(5);
		let session = startPractice(pool);
		let turn = 0;
		while (currentItem(session) && turn < 200) {
			const item = currentItem(session)!;
			// Every third answer is a miss, so items loop back.
			const right = ++turn % 3 !== 0;
			const outcome = recordPractice(
				app.db,
				{
					reviewId: `practice-${String(turn).padStart(8, '0')}`,
					cardPk: item.cardPk,
					ordinal: item.ordinal,
					right,
					durationMs: 500
				},
				{ clock }
			);
			expect(outcome.ok).toBe(true);
			session = answerPractice(session, right);
			clock.advance(7_000);
		}
		expect(currentItem(session)).toBeUndefined();

		// Exactly one new row per answer, all of them practice rows.
		expect(count('review_log')).toBe(logBefore + turn);
		expect(count('review_log', "mode = 'cram'")).toBe(turn);
		const after = worldOfStudy();
		// Time moved on during the session, so compare what does not depend on the clock, byte for byte.
		expect(after.cardState).toEqual(before.cardState);
		expect(after.cards).toEqual(before.cards);
		expect(after.decks).toEqual(before.decks);
		expect(after.folders).toEqual(before.folders);
		expect(after.settings).toEqual(before.settings);
		expect(after.reviewRows).toEqual(before.reviewRows);
		expect(after.leeches).toEqual(before.leeches);
		expect(after.leechCount).toBe(before.leechCount);
	});

	it('leaves every study number as it was: queue counts, folder statistics, weak tags', () => {
		const before = worldOfStudy();
		for (let i = 0; i < 12; i++) {
			expect(practice('alpha', 'a2', i % 2 === 0).ok).toBe(true);
			expect(practice('beta', 'b1', i % 3 === 0).ok).toBe(true);
			expect(practice('alpha', 'a4', false, 1).ok).toBe(true);
		}
		const after = worldOfStudy();
		expect(after.queueAll).toEqual(before.queueAll);
		expect(after.queueAlpha).toEqual(before.queueAlpha);
		expect(after.queueFolder).toEqual(before.queueFolder);
		expect(after.folder).toEqual(before.folder);
		expect(after.weakTags).toEqual(before.weakTags);
		expect(after.leechCount).toBe(before.leechCount);
	});

	it('keeps counting only real reviews against the daily limits', () => {
		const reviewsToday = () =>
			(
				sqlite().prepare("select count(*) as n from review_log where mode = 'review'").get() as {
					n: number;
				}
			).n;
		const before = reviewsToday();
		for (let i = 0; i < 30; i++) practice('alpha', 'a1', true);
		expect(reviewsToday()).toBe(before);
		// A card never studied is still new after being practiced.
		const state = sqlite()
			.prepare('select phase, reps from card_state where card_pk = ? and ordinal = 0')
			.get(pk('alpha', 'a3')) as { phase: number; reps: number };
		expect(state.phase).not.toBe(0); // a3 was studied in the setup
		const fresh = sqlite()
			.prepare('select phase, reps from card_state where card_pk = ? and ordinal = 0')
			.get(pk('gamma', 'c1')) as { phase: number; reps: number };
		expect(practice('gamma', 'c1', true).ok).toBe(true);
		expect(
			sqlite()
				.prepare('select phase, reps from card_state where card_pk = ? and ordinal = 0')
				.get(pk('gamma', 'c1'))
		).toEqual(fresh);
		expect(fresh).toEqual({ phase: 0, reps: 0 });
	});
});
