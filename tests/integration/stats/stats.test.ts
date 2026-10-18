import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatsDto, StatsScopeDto } from '#lib/core/api-types.ts';
import { handleStats } from '#lib/server/api/stats.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { folderStats } from '#lib/server/folders/index.ts';
import { createLogger } from '#lib/server/log.ts';
import { recordPractice } from '#lib/server/practice/index.ts';
import {
	getCardByKey,
	getFolder,
	insertFolder,
	setDeckArchived,
	setDecksFolder,
	setSuspended,
	updateState
} from '#lib/server/repos/index.ts';
import { scopeStats } from '#lib/server/stats/index.ts';
import { submitReview, type ReviewInput } from '#lib/server/study/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { importForSetup } from '../../helpers/setup-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The Statistics page (ADR-017): the numbers for every deck, one deck, or one folder, and the promise that practice
// answers are in none of them.

const TZ = 'America/Chicago';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ALL: StatsScopeDto = { kind: 'all', id: null, label: 'All decks' };

let dir: TempDir;
let app: AppContext;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	// 2026-10-12 10:00 in Chicago
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
	const tagged = (id: string, tag: string) => ({ ...basic(id), tags: [tag] });
	importForSetup(
		app.db,
		makeDeck([tagged('a1', 'routing'), tagged('a2', 'routing'), tagged('a3', 'switching')], {
			id: 'alpha',
			title: 'Alpha deck'
		}),
		clock
	);
	importForSetup(
		app.db,
		makeDeck([tagged('b1', 'routing'), tagged('b2', 'security')], {
			id: 'beta',
			title: 'Beta deck'
		}),
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
const context = () => ({ now: clock.now(), timeZone: TZ });

function study(deckId: string, key: string, grade: ReviewInput['grade']) {
	const result = submitReview(
		app.db,
		{
			reviewId: `review-${String(++counter).padStart(8, '0')}`,
			cardPk: pk(deckId, key),
			ordinal: 0,
			grade,
			servedAt: clock.now().toISOString(),
			durationMs: 2000
		},
		{ clock, timeZone: TZ }
	);
	if (!result.ok) throw new Error(`study failed: ${result.error.code}`);
}

function practice(deckId: string, key: string, right: boolean) {
	const result = recordPractice(
		app.db,
		{
			reviewId: `practice-${String(++counter).padStart(8, '0')}`,
			cardPk: pk(deckId, key),
			ordinal: 0,
			right,
			durationMs: 700
		},
		{ clock }
	);
	if (!result.ok) throw new Error(`practice failed: ${result.error.code}`);
}

const statsOf = (scope: { deckId?: string; folderId?: number }, label: StatsScopeDto = ALL) =>
	scopeStats(app.db, scope, label, context());

describe('an empty library', () => {
	it('has zeros, a streak of nothing, and a forecast and heatmap of the right shape', () => {
		const stats = statsOf({});
		expect(stats).toMatchObject({
			deckCount: 3,
			cardCount: 6,
			items: { new: 6, learning: 0, review: 0, suspended: 0 },
			openLeeches: 0,
			reviewsToday: 0,
			reviews7Days: 0,
			reviews30Days: 0,
			retention7Days: null,
			retention30Days: null,
			streakDays: 0,
			weakTags: [],
			tagRetention: [],
			practicedToday: { items: 0, answers: 0, timeMs: 0 }
		});
		expect(stats.days).toHaveLength(14);
		expect(stats.heatmap).toHaveLength(26);
		expect(stats.heatmap.every((week) => week.length === 7)).toBe(true);
		expect(stats.forecast.overdue).toBe(0);
		expect(stats.forecast.days).toHaveLength(30);
		expect(stats.forecast.days[0]!.day).toBe('2026-10-12');
	});
});

describe('a scope', () => {
	beforeEach(() => {
		study('alpha', 'a1', 3);
		study('alpha', 'a2', 1);
		study('beta', 'b1', 3);
		clock.advance(40 * MIN);
		study('gamma', 'c1', 4);
	});

	it('all decks adds up every deck', () => {
		const stats = statsOf({});
		expect(stats.reviewsToday).toBe(4);
		expect(stats.reviews7Days).toBe(4);
		expect(stats.timeTodayMs).toBe(8000);
		expect(stats.streakDays).toBe(1);
		expect(stats.days[13]).toMatchObject({ reviews: 4, remembered: 3 });
		expect(stats.items.new).toBe(2);
		expect(stats.scope).toEqual(ALL);
	});

	it('one deck counts only its own cards and reviews', () => {
		const label = { kind: 'deck', id: 'alpha', label: 'Alpha deck' } as const;
		const stats = statsOf({ deckId: 'alpha' }, label);
		expect(stats).toMatchObject({
			scope: label,
			deckCount: 1,
			cardCount: 3,
			reviewsToday: 2,
			timeTodayMs: 4000
		});
		expect(stats.items.new).toBe(1);
		expect(statsOf({ deckId: 'gamma' }).reviewsToday).toBe(1);
	});

	it('one folder counts the decks in it, and equals the folder panel', () => {
		const folder = insertFolder(app.db, 'Course', clock.now().toISOString());
		setDecksFolder(app.db, ['alpha', 'beta'], folder.id);
		const stats = statsOf({ folderId: folder.id });
		expect(stats).toMatchObject({ deckCount: 2, cardCount: 5, reviewsToday: 3 });

		const panel = folderStats(app.db, getFolder(app.db, folder.id)!, context());
		const numbers: Partial<typeof panel> = { ...panel };
		delete numbers.folder;
		expect(numbers).toEqual({
			items: stats.items,
			openLeeches: stats.openLeeches,
			reviewsToday: stats.reviewsToday,
			reviews7Days: stats.reviews7Days,
			reviews30Days: stats.reviews30Days,
			timeTodayMs: stats.timeTodayMs,
			time7DaysMs: stats.time7DaysMs,
			retention7Days: stats.retention7Days,
			retention30Days: stats.retention30Days,
			streakDays: stats.streakDays,
			days: stats.days,
			weakTags: stats.weakTags
		});
	});

	it('leaves out decks in the Trash and cards that were removed', () => {
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		const stats = statsOf({});
		expect(stats.deckCount).toBe(2);
		expect(stats.cardCount).toBe(4);
		expect(stats.reviewsToday).toBe(3);
		sqlite().prepare('update cards set archived = 1 where pk = ?').run(pk('gamma', 'c1'));
		expect(statsOf({}).cardCount).toBe(3);
	});

	it('counts suspended items apart and open leeches by scope', () => {
		setSuspended(app.db, pk('alpha', 'a3'), true);
		updateState(app.db, pk('alpha', 'a2'), 0, { leech: true, lapses: 9 });
		updateState(app.db, pk('gamma', 'c1'), 0, { leech: true, lapses: 9 });
		expect(statsOf({}).items.suspended).toBe(1);
		expect(statsOf({}).openLeeches).toBe(2);
		expect(statsOf({ deckId: 'alpha' }).openLeeches).toBe(1);
		expect(statsOf({ deckId: 'beta' }).openLeeches).toBe(0);
	});
});

describe('the heatmap and the streak', () => {
	it('count reviews on the days they were made', () => {
		study('alpha', 'a1', 3); // 2026-10-12
		clock.advance(DAY);
		study('alpha', 'a2', 3); // 2026-10-13
		study('alpha', 'a3', 3);
		clock.advance(DAY);
		const stats = statsOf({});
		const cells = new Map(
			stats.heatmap.flat().flatMap((cell) => (cell ? [[cell.day, cell.reviews]] : []))
		);
		expect(cells.get('2026-10-12')).toBe(1);
		expect(cells.get('2026-10-13')).toBe(2);
		expect(cells.get('2026-10-14')).toBe(0);
		expect(stats.streakDays).toBe(2);
	});
});

describe('the forecast', () => {
	it('counts review items by the study day they fall due and the overdue ones apart', () => {
		const set = (deckId: string, key: string, due: string, phase = 2) =>
			updateState(app.db, pk(deckId, key), 0, { due, phase, reps: 3 });
		set('alpha', 'a1', '2026-10-12T20:00:00.000Z'); // today
		set('alpha', 'a2', '2026-10-13T20:00:00.000Z'); // tomorrow
		set('alpha', 'a3', '2026-10-13T21:00:00.000Z'); // tomorrow
		set('beta', 'b1', '2026-10-30T15:00:00.000Z'); // 2026-10-30
		set('beta', 'b2', '2026-10-09T15:00:00.000Z'); // overdue
		set('gamma', 'c1', '2026-10-12T15:30:00.000Z', 1); // learning, due soon: today
		const stats = statsOf({});
		const byDay = Object.fromEntries(stats.forecast.days.map((entry) => [entry.day, entry.due]));
		expect(byDay['2026-10-12']).toBe(2);
		expect(byDay['2026-10-13']).toBe(2);
		expect(byDay['2026-10-30']).toBe(1);
		expect(stats.forecast.overdue).toBe(1);
		expect(statsOf({ deckId: 'alpha' }).forecast.overdue).toBe(0);
	});

	it('leaves out suspended cards, removed items, and decks in the Trash', () => {
		const soon = { due: '2026-10-13T20:00:00.000Z', phase: 2, reps: 3 };
		updateState(app.db, pk('alpha', 'a1'), 0, soon);
		updateState(app.db, pk('alpha', 'a2'), 0, soon);
		updateState(app.db, pk('beta', 'b1'), 0, soon);
		setSuspended(app.db, pk('alpha', 'a1'), true);
		sqlite().prepare('update card_state set archived = 1 where card_pk = ?').run(pk('alpha', 'a2'));
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(statsOf({}).forecast.days.reduce((total, entry) => total + entry.due, 0)).toBe(0);
	});
});

describe('tag retention', () => {
	it('ranks tags with at least five review-phase reviews, lowest recall first', () => {
		// Put every card into the review phase, then review them in the review phase with a mix of grades.
		for (const [deckId, key] of [
			['alpha', 'a1'],
			['alpha', 'a2'],
			['alpha', 'a3'],
			['beta', 'b1'],
			['beta', 'b2']
		] as const) {
			updateState(app.db, pk(deckId, key), 0, {
				due: '2026-10-11T12:00:00.000Z',
				phase: 2,
				reps: 4,
				stability: 5,
				difficulty: 5,
				lastReview: '2026-10-06T12:00:00.000Z'
			});
		}
		const grades: [string, string, ReviewInput['grade']][] = [
			['alpha', 'a1', 3],
			['alpha', 'a1', 1],
			['alpha', 'a2', 1],
			['alpha', 'a2', 1],
			['beta', 'b1', 3],
			['beta', 'b1', 3],
			['alpha', 'a3', 3],
			['alpha', 'a3', 3],
			['alpha', 'a3', 3],
			['alpha', 'a3', 3],
			['alpha', 'a3', 3]
		];
		for (const [deckId, key, grade] of grades) {
			updateState(app.db, pk(deckId, key), 0, { due: '2026-10-11T12:00:00.000Z', phase: 2 });
			study(deckId, key, grade);
			clock.advance(MIN);
		}
		const stats = statsOf({});
		// routing: a1 (2), a2 (2), b1 (2) = 6 reviews, 3 remembered; switching: 5 reviews, all remembered;
		// security: no reviews.
		expect(stats.tagRetention.map((tag) => tag.tag)).toEqual(['routing', 'switching']);
		expect(stats.tagRetention[0]).toMatchObject({ tag: 'routing', reviews: 6, cards: 3 });
		expect(stats.tagRetention[0]!.retention).toBeCloseTo(0.5);
		expect(stats.tagRetention[1]).toMatchObject({ tag: 'switching', reviews: 5, retention: 1 });
		// A tag with fewer than five reviews is not ranked.
		expect(statsOf({ deckId: 'beta' }).tagRetention).toEqual([]);
	});
});

// The promise of ADR-017: practice answers are in none of the study numbers.
describe('practice', () => {
	it('is reported apart and changes no study number', () => {
		study('alpha', 'a1', 3);
		clock.advance(MIN);
		const before = statsOf({});
		for (let i = 0; i < 6; i++) practice('alpha', 'a1', i % 2 === 0);
		practice('alpha', 'a2', true);
		practice('beta', 'b1', false);
		const after = statsOf({});

		const practiced = after.practicedToday;
		const numbers: Partial<StatsDto> = { ...after };
		const previous: Partial<StatsDto> = { ...before };
		delete numbers.practicedToday;
		delete previous.practicedToday;
		expect(numbers).toEqual(previous);
		expect(practiced).toEqual({ items: 3, answers: 8, timeMs: 5600 });
		expect(statsOf({ deckId: 'alpha' }).practicedToday).toEqual({
			items: 2,
			answers: 7,
			timeMs: 4900
		});
		expect(statsOf({ deckId: 'gamma' }).practicedToday).toEqual({
			items: 0,
			answers: 0,
			timeMs: 0
		});
	});

	it('is counted for the current study day only', () => {
		practice('alpha', 'a1', true);
		clock.advance(DAY);
		practice('alpha', 'a2', true);
		expect(statsOf({}).practicedToday).toMatchObject({ items: 1, answers: 1 });
	});

	it('leaves out decks in the Trash', () => {
		practice('beta', 'b1', true);
		setDeckArchived(app.db, 'beta', true, clock.now().toISOString());
		expect(statsOf({}).practicedToday.answers).toBe(0);
	});
});

describe('GET /api/stats', () => {
	const call = (query: string) =>
		handleStats(app, new URL(`http://localhost/api/stats${query}`), 'req');

	it('answers for every deck, one deck, and one folder, naming the scope', async () => {
		const folder = insertFolder(app.db, 'CCNA', clock.now().toISOString());
		setDecksFolder(app.db, ['alpha'], folder.id);
		const all = (await call('').json()) as StatsDto;
		expect(all.scope).toEqual({ kind: 'all', id: null, label: 'All decks' });
		const deck = (await call('?deckId=beta').json()) as StatsDto;
		expect(deck.scope).toEqual({ kind: 'deck', id: 'beta', label: 'Beta deck' });
		expect(deck.cardCount).toBe(2);
		const group = (await call(`?folderId=${folder.id}`).json()) as StatsDto;
		expect(group.scope).toEqual({ kind: 'folder', id: folder.id, label: 'CCNA' });
		expect(group.cardCount).toBe(3);
	});

	it('refuses both a deck and a folder, a bad id, and an unknown deck or folder', () => {
		expect(call('?deckId=alpha&folderId=1').status).toBe(400);
		expect(call('?deckId=Bad%20Id').status).toBe(400);
		expect(call('?folderId=abc').status).toBe(400);
		expect(call('?folderId=0').status).toBe(400);
		expect(call('?deckId=nothing').status).toBe(404);
		expect(call('?folderId=99').status).toBe(404);
	});

	it('writes nothing', () => {
		const before = sqlite().prepare('select count(*) as n from review_log').get();
		call('');
		call('?deckId=alpha');
		expect(sqlite().prepare('select count(*) as n from review_log').get()).toEqual(before);
	});
});
