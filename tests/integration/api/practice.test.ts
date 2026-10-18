import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	PracticeGradeResponse,
	PracticeItemResponse,
	PracticePoolResponse,
	PracticeStartResponse
} from '#lib/core/api-types.ts';
import {
	handlePracticeGrade,
	handlePracticeItem,
	handlePracticePool,
	handlePracticeStart
} from '#lib/server/api/practice.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import {
	getCardByKey,
	insertFolder,
	setDeckArchived,
	setDecksFolder
} from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { importForSetup } from '../../helpers/setup-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Practice again over HTTP (ADR-017): the four routes, what they accept, and what they answer.

let dir: TempDir;
let app: AppContext;

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T15:00:00.000Z'),
		rng: () => 0.5,
		log: createLogger({ level: 'error', write: () => {} })
	});
	importForSetup(
		app.db,
		makeDeck([basic('a1'), basic('a2'), basic('a3')], { id: 'alpha', title: 'Alpha deck' }),
		app.clock
	);
	importForSetup(
		app.db,
		makeDeck([basic('b1'), basic('b2')], { id: 'beta', title: 'Beta deck' }),
		app.clock
	);
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const post = (value: unknown, raw = false) =>
	new Request('http://localhost/api/practice', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (value as string) : JSON.stringify(value)
	});

const url = (path: string) => new URL(`http://localhost${path}`);
const pk = (deckId: string, key: string) => getCardByKey(app.db, deckId, key)!.pk;
const log = () =>
	app.database.sqlite.prepare('select * from review_log order by reviewed_at, id').all() as Record<
		string,
		unknown
	>[];

const errorOf = async (response: Response) =>
	(
		(await response.json()) as {
			error: {
				code: string;
				message: string;
				details?: { errors?: { path: string; code: string }[] };
			};
		}
	).error;

describe('GET /api/practice/pool', () => {
	it('counts the items of a deck and names it', async () => {
		const response = handlePracticePool(app, url('/api/practice/pool?deckId=alpha'), 'req');
		expect(response.status).toBe(200);
		expect((await response.json()) as PracticePoolResponse).toEqual({
			label: 'Alpha deck',
			total: 3,
			unstudied: 3
		});
	});

	it('counts the items of a folder and names it', async () => {
		const folder = insertFolder(app.db, 'CCNA', app.clock.now().toISOString());
		setDecksFolder(app.db, ['alpha', 'beta'], folder.id);
		const response = handlePracticePool(
			app,
			url(`/api/practice/pool?folderId=${folder.id}`),
			'req'
		);
		expect((await response.json()) as PracticePoolResponse).toEqual({
			label: 'CCNA',
			total: 5,
			unstudied: 5
		});
	});

	it('needs exactly one of deck and folder, and a real one', async () => {
		const none = handlePracticePool(app, url('/api/practice/pool'), 'req');
		expect(none.status).toBe(400);
		const both = handlePracticePool(app, url('/api/practice/pool?deckId=alpha&folderId=1'), 'req');
		expect(both.status).toBe(400);
		expect(handlePracticePool(app, url('/api/practice/pool?deckId=missing'), 'req').status).toBe(
			404
		);
		expect(handlePracticePool(app, url('/api/practice/pool?folderId=77'), 'req').status).toBe(404);
		expect(handlePracticePool(app, url('/api/practice/pool?folderId=abc'), 'req').status).toBe(400);
		expect(handlePracticePool(app, url('/api/practice/pool?deckId=Bad%20Id'), 'req').status).toBe(
			400
		);
	});
});

describe('POST /api/practice/start', () => {
	it('returns the ordered references and the pool size', async () => {
		const response = await handlePracticeStart(
			app,
			post({ deckId: 'alpha', count: 2, order: 'shuffle' }),
			'req'
		);
		expect(response.status).toBe(200);
		const started = (await response.json()) as PracticeStartResponse;
		expect(started.poolSize).toBe(3);
		expect(started.items).toHaveLength(2);
		for (const entry of started.items) {
			expect(Object.keys(entry).sort()).toEqual(['cardPk', 'ordinal']);
		}
	});

	it('accepts all, weakest, and a folder', async () => {
		const folder = insertFolder(app.db, 'CCNA', app.clock.now().toISOString());
		setDecksFolder(app.db, ['beta'], folder.id);
		const response = await handlePracticeStart(
			app,
			post({ folderId: folder.id, count: 'all', order: 'weakest' }),
			'req'
		);
		expect(response.status).toBe(200);
		expect(((await response.json()) as PracticeStartResponse).items).toHaveLength(2);
	});

	it('answers an empty list for a deck in the Trash, not an error', async () => {
		setDeckArchived(app.db, 'beta', true, app.clock.now().toISOString());
		const response = await handlePracticeStart(
			app,
			post({ deckId: 'beta', count: 'all', order: 'shuffle' }),
			'req'
		);
		expect(await response.json()).toEqual({ items: [], poolSize: 0 });
	});

	it('refuses a request that is not exactly a deck or a folder, a count, and an order', async () => {
		const good = { deckId: 'alpha', count: 'all', order: 'shuffle' };
		for (const bad of [
			{},
			{ count: 'all', order: 'shuffle' },
			{ ...good, folderId: 1 },
			{ ...good, count: 0 },
			{ ...good, count: -3 },
			{ ...good, count: 1.5 },
			{ ...good, count: 100_001 },
			{ ...good, count: 'many' },
			{ ...good, order: 'random' },
			{ ...good, extra: true },
			{ ...good, deckId: 7 },
			[],
			'text',
			null
		]) {
			const response = await handlePracticeStart(app, post(bad), 'req');
			expect(response.status, JSON.stringify(bad)).toBe(422);
			expect((await errorOf(response)).code).toBe('validation_failed');
		}
		const broken = await handlePracticeStart(app, post('{nope', true), 'req');
		expect(broken.status).toBe(400);
	});

	it('answers 404 for an unknown deck or folder', async () => {
		const deck = await handlePracticeStart(
			app,
			post({ deckId: 'nothing', count: 'all', order: 'shuffle' }),
			'req'
		);
		expect(deck.status).toBe(404);
		const folder = await handlePracticeStart(
			app,
			post({ folderId: 99, count: 'all', order: 'shuffle' }),
			'req'
		);
		expect(folder.status).toBe(404);
	});

	it('writes nothing', async () => {
		await handlePracticeStart(
			app,
			post({ deckId: 'alpha', count: 'all', order: 'weakest' }),
			'req'
		);
		expect(log()).toEqual([]);
	});
});

describe('GET /api/practice/item', () => {
	it('answers the item without schedule parts', async () => {
		const response = handlePracticeItem(
			app,
			url(`/api/practice/item?cardPk=${pk('alpha', 'a1')}&ordinal=0`),
			'req'
		);
		expect(response.status).toBe(200);
		const { item } = (await response.json()) as PracticeItemResponse;
		expect(item).toMatchObject({ deckId: 'alpha', key: 'a1', type: 'basic' });
		expect(item).not.toHaveProperty('previews');
		expect(item).not.toHaveProperty('servedAt');
	});

	it('refuses numbers that are not whole numbers, and items that do not exist', async () => {
		for (const query of [
			'',
			'?cardPk=1',
			'?ordinal=0',
			'?cardPk=0&ordinal=0',
			'?cardPk=-1&ordinal=0',
			'?cardPk=1.5&ordinal=0',
			'?cardPk=abc&ordinal=0',
			'?cardPk=1&ordinal=100',
			'?cardPk=12345678901&ordinal=0'
		]) {
			expect(handlePracticeItem(app, url(`/api/practice/item${query}`), 'req').status, query).toBe(
				400
			);
		}
		expect(
			handlePracticeItem(app, url('/api/practice/item?cardPk=999999&ordinal=0'), 'req').status
		).toBe(404);
	});

	it('does not show a card from a deck in the Trash', async () => {
		setDeckArchived(app.db, 'beta', true, app.clock.now().toISOString());
		expect(
			handlePracticeItem(app, url(`/api/practice/item?cardPk=${pk('beta', 'b1')}&ordinal=0`), 'req')
				.status
		).toBe(404);
	});
});

describe('POST /api/practice/grade', () => {
	const body = (key: string, overrides: Record<string, unknown> = {}, deckId = 'alpha') => ({
		reviewId: 'practice-http-001',
		cardPk: pk(deckId, key),
		ordinal: 0,
		right: true,
		durationMs: 800,
		...overrides
	});

	it('records one practice row and nothing else', async () => {
		const before = app.database.sqlite.prepare('select * from card_state order by 1, 2').all();
		const response = await handlePracticeGrade(app, post(body('a1')), 'req');
		expect(response.status).toBe(200);
		expect((await response.json()) as PracticeGradeResponse).toEqual({ replayed: false });
		expect(log()).toHaveLength(1);
		expect(log()[0]).toMatchObject({ id: 'practice-http-001', mode: 'cram', grade: 3 });
		expect(app.database.sqlite.prepare('select * from card_state order by 1, 2').all()).toEqual(
			before
		);
	});

	it('records a miss as grade 1 and answers a retry as a replay', async () => {
		await handlePracticeGrade(app, post(body('a1', { right: false })), 'req');
		const again = await handlePracticeGrade(app, post(body('a1', { right: false })), 'req');
		expect(again.status).toBe(200);
		expect((await again.json()) as PracticeGradeResponse).toEqual({ replayed: true });
		expect(log()).toHaveLength(1);
		expect(log()[0]).toMatchObject({ grade: 1 });
	});

	it('answers 400 for an id used on another card, and 404 for an item that cannot be practiced', async () => {
		await handlePracticeGrade(app, post(body('a1')), 'req');
		const reused = await handlePracticeGrade(app, post(body('a2')), 'req');
		expect(reused.status).toBe(400);
		expect((await errorOf(reused)).code).toBe('bad_request');

		setDeckArchived(app.db, 'beta', true, app.clock.now().toISOString());
		const gone = await handlePracticeGrade(
			app,
			post(body('b1', { reviewId: 'practice-http-002' }, 'beta')),
			'req'
		);
		expect(gone.status).toBe(404);
		expect(log()).toHaveLength(1);
	});

	it('refuses a body that is not exactly an answer', async () => {
		for (const bad of [
			{},
			{ ...body('a1'), extra: 1 },
			{ ...body('a1'), right: 'yes' },
			{ ...body('a1'), reviewId: 'x' },
			{ ...body('a1'), cardPk: 'one' },
			{ ...body('a1'), grade: 3 },
			[],
			null
		]) {
			const response = await handlePracticeGrade(app, post(bad), 'req');
			expect(response.status, JSON.stringify(bad)).toBe(422);
		}
		expect((await handlePracticeGrade(app, post('{nope', true), 'req')).status).toBe(400);
		expect(log()).toEqual([]);
	});

	it('refuses a body over the small limit', async () => {
		const big = await handlePracticeGrade(
			app,
			post(body('a1', { typedAnswer: 'x'.repeat(20_000) })),
			'req'
		);
		expect([413, 422]).toContain(big.status);
		expect(log()).toEqual([]);
	});
});
