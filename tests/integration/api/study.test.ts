import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleStudyNext, handleStudyReview } from '#lib/server/api/study.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

const START = '2026-10-10T12:00:00.000Z';
const MIN = 60_000;

let dir: TempDir;
let app: AppContext;
let clock: FakeClock;
const logged: Record<string, unknown>[] = [];
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(START);
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	counter = 0;
	app = createApp({
		config: config.value,
		clock,
		rng: () => 0,
		log: createLogger({
			level: 'info',
			write: (line) => logged.push(JSON.parse(line) as Record<string, unknown>)
		})
	});
});

afterEach(() => {
	app.database.close();
	dir.cleanup();
});

function importDeck(cards: Record<string, unknown>[], meta: Record<string, unknown> = {}) {
	const result = commitImport(
		app.db,
		makeDeck(cards, { id: 'ccna', title: 'CCNA', ...meta }),
		{ archiveMissing: false, format: 'json' },
		clock
	);
	if (!result.ok) throw new Error(JSON.stringify(result.error));
}

async function next(query = '') {
	const response = handleStudyNext(
		app,
		new URL(`http://localhost/api/study/next${query}`),
		'req-1'
	);
	return { response, body: await response.json() };
}

async function review(body: Record<string, unknown>, raw?: string) {
	const response = await handleStudyReview(
		app,
		new Request('http://localhost/api/study/review', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: raw ?? JSON.stringify(body)
		}),
		'req-1'
	);
	return { response, body: await response.json() };
}

function answer(
	item: { cardPk: number; ordinal: number; servedAt: string },
	grade: number,
	extra = {}
) {
	return {
		reviewId: `session-${String(++counter).padStart(8, '0')}`,
		cardPk: item.cardPk,
		ordinal: item.ordinal,
		grade,
		servedAt: item.servedAt,
		...extra
	};
}

describe('GET /api/study/next', () => {
	it('is done with zero counts when there is nothing to study', async () => {
		const { response, body } = await next();
		expect(response.status).toBe(200);
		expect(body).toEqual({
			done: true,
			waitingUntil: null,
			counts: { learning: 0, review: 0, new: 0 }
		});
	});

	it('serves a new card with its content, grade labels, and servedAt', async () => {
		importDeck([
			{
				id: 'hello',
				type: 'basic',
				front: 'Default hello interval?',
				back: '10 seconds',
				hint: 'dead is 4x',
				tags: ['timers']
			},
			basic('b')
		]);
		const { response, body } = await next();
		expect(response.status).toBe(200);
		expect(body.done).toBe(false);
		expect(body.counts).toEqual({ learning: 0, review: 0, new: 2 });
		expect(body.item).toMatchObject({
			category: 'new',
			ordinal: 0,
			deckId: 'ccna',
			deckTitle: 'CCNA',
			key: 'hello',
			type: 'basic',
			content: { front: 'Default hello interval?', back: '10 seconds', hint: 'dead is 4x' },
			tags: ['timers'],
			servedAt: START,
			state: { phase: 0, reps: 0, lapses: 0 }
		});
		expect(body.item.previews).toEqual({
			'1': { label: '1m' },
			'2': { label: expect.stringMatching(/^\d+m$/) },
			'3': { label: '10m' },
			'4': { label: expect.stringMatching(/^\d+d$/) }
		});
	});

	it('reports a cloze item with the number of the blank to ask', async () => {
		importDeck([cloze('dr', 'The {{c1::DR}} and {{c2::BDR}}')]);
		const { body } = await next();
		expect(body.item).toMatchObject({
			type: 'cloze',
			ordinal: 1,
			content: { text: 'The {{c1::DR}} and {{c2::BDR}}' }
		});
	});

	it('filters by deck and rejects unknown or malformed deck ids', async () => {
		importDeck([basic('a')]);
		importDeck([basic('z')], { id: 'other', title: 'Other' });
		expect((await next('?deckId=other')).body.item.key).toBe('z');

		const unknown = await next('?deckId=nope');
		expect(unknown.response.status).toBe(404);
		expect(unknown.body.error.code).toBe('not_found');

		const malformed = await next('?deckId=BAD%20ID');
		expect(malformed.response.status).toBe(400);
		expect(malformed.body.error.code).toBe('bad_request');
	});

	it('reports when the next learning card will be due', async () => {
		importDeck([basic('a')]);
		const first = (await next()).body.item;
		await review(answer(first, 3, { deckId: 'ccna' }));
		clock.advance(MIN); // the card is due in 10 minutes, which is inside the learn-ahead window
		expect((await next()).body.item.category).toBe('learning');
	});

	it('does not log card content', async () => {
		importDeck([{ id: 'a', type: 'basic', front: 'SECRET FRONT', back: 'SECRET BACK' }]);
		await next();
		expect(JSON.stringify(logged)).not.toContain('SECRET');
	});
});

describe('POST /api/study/review', () => {
	it('records the answer and returns the result with the next card', async () => {
		importDeck([basic('a'), basic('b')]);
		const item = (await next()).body.item;
		const { response, body } = await review(
			answer(item, 3, { deckId: 'ccna', durationMs: 1800, typedAnswer: 'x' })
		);

		expect(response.status).toBe(200);
		expect(body.result).toMatchObject({
			replayed: false,
			grade: 3,
			cardPk: item.cardPk,
			becameLeech: false
		});
		expect(body.result.next).toMatchObject({ phase: 1, reps: 1 });
		expect(body.next.done).toBe(false);
		expect(body.next.item.key).toBe('b'); // a is now learning, b is the next new card
		expect(body.next.counts).toEqual({ learning: 0, review: 0, new: 1 });
	});

	it('returns the stored result for a repeated reviewId', async () => {
		importDeck([basic('a'), basic('b')]);
		const item = (await next()).body.item;
		const payload = answer(item, 3);
		const first = await review(payload);
		clock.advance(5000);
		const again = await review(payload);
		expect(again.response.status).toBe(200);
		expect(again.body.result.replayed).toBe(true);
		expect(again.body.result.next).toEqual(first.body.result.next);
	});

	it('returns 409 for a stale answer and 404 for a missing card', async () => {
		importDeck([basic('a'), basic('b')]);
		const item = (await next()).body.item;
		clock.advance(MIN);
		await review(answer(item, 3)); // another tab answers first
		clock.advance(MIN);
		const stale = await review(answer(item, 4));
		expect(stale.response.status).toBe(409);
		expect(stale.body.error).toMatchObject({
			code: 'stale_review',
			details: { reason: 'stale_review' }
		});

		const missing = await review({ ...answer(item, 3), cardPk: 9999 });
		expect(missing.response.status).toBe(404);
		expect(missing.body.error.code).toBe('not_found');
	});

	it('rejects a reused review id for another card', async () => {
		importDeck([basic('a'), basic('b')]);
		const first = (await next()).body.item;
		const payload = answer(first, 3);
		const accepted = await review(payload);
		const other = accepted.body.next.item;
		const reuse = await review({ ...payload, cardPk: other.cardPk, servedAt: other.servedAt });
		expect(reuse.response.status).toBe(400);
		expect(reuse.body.error.message).toContain('different card');
	});

	it('reports path-level validation errors', async () => {
		importDeck([basic('a')]);
		const item = (await next()).body.item;
		const bad = await review({ ...answer(item, 3), grade: 9, servedAt: 'yesterday', extra: true });
		expect(bad.response.status).toBe(422);
		const paths = bad.body.error.details.errors.map((e: { path: string }) => e.path);
		expect(paths).toEqual(expect.arrayContaining(['grade', 'servedAt']));
		expect(
			bad.body.error.details.errors.some((e: { code: string }) => e.code === 'unknown_field')
		).toBe(true);
	});

	it('rejects invalid JSON, oversized bodies, and an unknown deck', async () => {
		importDeck([basic('a')]);
		const item = (await next()).body.item;
		expect((await review({}, '{ not json')).response.status).toBe(400);
		expect((await review({}, 'x'.repeat(17 * 1024))).response.status).toBe(413);
		const unknownDeck = await review(answer(item, 3, { deckId: 'nope' }));
		expect(unknownDeck.response.status).toBe(404);
	});

	it('does not log answers or typed text', async () => {
		importDeck([basic('a')]);
		const item = (await next()).body.item;
		await review(answer(item, 3, { typedAnswer: 'PRIVATE ANSWER' }));
		expect(JSON.stringify(logged)).not.toContain('PRIVATE');
	});
});

describe('a whole session through the API', () => {
	it('works through every card until nothing is left, then reports the wait', async () => {
		importDeck([basic('a'), basic('b'), cloze('dr', '{{c1::x}} {{c2::y}}')]);
		const seen: string[] = [];

		let response = (await next()).body;
		for (let guard = 0; guard < 30 && !response.done; guard++) {
			const item = response.item;
			seen.push(`${item.key}:${item.ordinal}:${item.category}`);
			response = (await review(answer(item, 3, { deckId: 'ccna' }))).body.next;
		}

		// a and b are new, the cloze card has two items but its sibling is buried after the first.
		expect(seen).toEqual([
			'a:0:new',
			'b:0:new',
			'dr:1:new',
			'a:0:learning',
			'b:0:learning',
			'dr:1:learning'
		]);
		expect(response.done).toBe(true);
		expect(response.counts).toEqual({ learning: 0, review: 0, new: 0 });
	});

	it('shows the learning cards again after their step and then graduates them', async () => {
		importDeck([basic('a')]);
		const first = (await next()).body.item;
		const afterFirst = (await review(answer(first, 3))).body;
		expect(afterFirst.result.next.phase).toBe(1);

		clock.advance(11 * MIN);
		const due = (await next()).body.item;
		expect(due.category).toBe('learning');
		const graduated = (await review(answer(due, 3))).body;
		expect(graduated.result.next.phase).toBe(2);
		expect(graduated.next.done).toBe(true);
	});
});
