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

describe('a tag as the scope (ADR-020)', () => {
	const tagCards = (tag: string, ...keys: [string, string][]) => {
		for (const [deckId, key] of keys) {
			app.database.sqlite
				.prepare('update cards set tags = ? where pk = ?')
				.run(JSON.stringify([tag]), pk(deckId, key));
		}
	};

	it('counts the items that carry the tag, across decks, and names the scope', async () => {
		tagCards('net', ['alpha', 'a1'], ['alpha', 'a2'], ['beta', 'b1']);
		const response = handlePracticePool(app, url('/api/practice/pool?tag=net'), 'req');
		expect(response.status).toBe(200);
		expect((await response.json()) as PracticePoolResponse).toEqual({
			label: 'Tag: net',
			total: 3,
			unstudied: 3
		});
	});

	it('answers an empty pool, not an error, for a tag no card has', async () => {
		const response = handlePracticePool(app, url('/api/practice/pool?tag=nothing'), 'req');
		expect(response.status).toBe(200);
		expect(((await response.json()) as PracticePoolResponse).total).toBe(0);
	});

	it('starts a session over a tag', async () => {
		tagCards('net', ['alpha', 'a1'], ['beta', 'b1']);
		const response = await handlePracticeStart(
			app,
			post({ tag: 'net', count: 'all', order: 'weakest' }),
			'req'
		);
		expect(response.status).toBe(200);
		const started = (await response.json()) as PracticeStartResponse;
		expect(started.poolSize).toBe(2);
		expect(started.items).toHaveLength(2);
	});

	it('accepts a tag with spaces and punctuation, and encodes it in the address', async () => {
		tagCards('chapter 3: routing (v2)', ['alpha', 'a1']);
		const response = handlePracticePool(
			app,
			url(`/api/practice/pool?tag=${encodeURIComponent('chapter 3: routing (v2)')}`),
			'req'
		);
		expect(((await response.json()) as PracticePoolResponse).total).toBe(1);
	});

	it('needs exactly one of deck, folder, and tag', async () => {
		expect(
			handlePracticePool(app, url('/api/practice/pool?tag=net&deckId=alpha'), 'req').status
		).toBe(400);
		expect(
			handlePracticePool(app, url('/api/practice/pool?tag=net&folderId=1'), 'req').status
		).toBe(400);
		for (const bad of [
			{ tag: 'net', deckId: 'alpha', count: 'all', order: 'shuffle' },
			{ tag: 'net', folderId: 1, count: 'all', order: 'shuffle' },
			{ count: 'all', order: 'shuffle' }
		]) {
			const response = await handlePracticeStart(app, post(bad), 'req');
			expect(response.status, JSON.stringify(bad)).toBe(422);
		}
	});

	it('refuses a tag a card could not carry', async () => {
		for (const tag of ['', ' lead', 'trail ', 'a,b', 'line\nbreak', 'x'.repeat(41)]) {
			expect(
				handlePracticePool(app, url(`/api/practice/pool?tag=${encodeURIComponent(tag)}`), 'req')
					.status,
				JSON.stringify(tag)
			).toBe(400);
			const response = await handlePracticeStart(
				app,
				post({ tag, count: 'all', order: 'shuffle' }),
				'req'
			);
			expect(response.status, JSON.stringify(tag)).toBe(422);
		}
		expect(
			(await handlePracticeStart(app, post({ tag: 5, count: 'all', order: 'shuffle' }), 'req'))
				.status
		).toBe(422);
	});
});

describe('Quiz me over HTTP (ADR-020)', () => {
	beforeEach(() => {
		importForSetup(
			app.db,
			makeDeck(
				[
					basic('q1', 'Which is Cisco only?', 'EIGRP'),
					basic('q2', 'Which uses Dijkstra?', 'OSPF'),
					basic('q3', 'Which is a distance vector?', 'RIP'),
					basic('q4', 'Which is path vector?', 'BGP'),
					basic('q5', 'Which is link state and from ISO?', 'IS-IS')
				],
				{ id: 'quizdeck', title: 'Quiz deck' }
			),
			app.clock
		);
	});

	const quizPk = (key: string) => getCardByKey(app.db, 'quizdeck', key)!.pk;

	it('gives a seed only when a quiz is asked for', async () => {
		const quiz = await handlePracticeStart(
			app,
			post({ deckId: 'quizdeck', count: 'all', order: 'shuffle', quiz: true }),
			'req'
		);
		expect(quiz.status).toBe(200);
		expect(((await quiz.json()) as PracticeStartResponse).quizSeed).toMatch(/^[a-z0-9]{16}$/);
		for (const body of [
			{ deckId: 'quizdeck', count: 'all', order: 'shuffle' },
			{ deckId: 'quizdeck', count: 'all', order: 'shuffle', quiz: false }
		]) {
			const response = await handlePracticeStart(app, post(body), 'req');
			expect(((await response.json()) as PracticeStartResponse).quizSeed).toBeUndefined();
		}
	});

	it('refuses a quiz flag that is not a boolean', async () => {
		for (const quiz of ['yes', 1, null, [], {}]) {
			const response = await handlePracticeStart(
				app,
				post({ deckId: 'quizdeck', count: 'all', order: 'shuffle', quiz }),
				'req'
			);
			expect(response.status, JSON.stringify(quiz)).toBe(422);
		}
	});

	it('answers a basic card as a choice card when the seed is sent, the same every time', async () => {
		const path = `/api/practice/item?cardPk=${quizPk('q1')}&ordinal=0&quizSeed=abcd1234efgh5678`;
		const first = (await (
			await handlePracticeItem(app, url(path), 'req')
		).json()) as PracticeItemResponse;
		expect(first.item.type).toBe('choice');
		expect(first.item.quiz).toBe(true);
		const content = first.item.content as { front: string; choices: string[]; correct: number };
		expect(content.front).toBe('Which is Cisco only?');
		expect(content.choices[content.correct]).toBe('EIGRP');
		expect(content.choices).toHaveLength(4);
		const again = (await (
			await handlePracticeItem(app, url(path), 'req')
		).json()) as PracticeItemResponse;
		expect(again).toEqual(first);
	});

	it('answers the card as it is without a seed', async () => {
		const response = await handlePracticeItem(
			app,
			url(`/api/practice/item?cardPk=${quizPk('q1')}&ordinal=0`),
			'req'
		);
		const body = (await response.json()) as PracticeItemResponse;
		expect(body.item.type).toBe('basic');
		expect(body.item.quiz).toBeUndefined();
	});

	it('refuses a seed that is not letters and digits of a sensible length', async () => {
		for (const seed of [
			'',
			'short',
			'x'.repeat(33),
			'has space 12345',
			'bad-char-12345',
			'<script>x1'
		]) {
			const response = await handlePracticeItem(
				app,
				url(
					`/api/practice/item?cardPk=${quizPk('q1')}&ordinal=0&quizSeed=${encodeURIComponent(seed)}`
				),
				'req'
			);
			expect(response.status, JSON.stringify(seed)).toBe(400);
		}
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
