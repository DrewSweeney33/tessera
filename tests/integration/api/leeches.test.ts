import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { LeechesResponse } from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import {
	handleListLeeches,
	handleResetLeech,
	handleSetSuspended,
	handleWeakSpotReport
} from '#lib/server/api/leeches.ts';
import { cards, cardState, reviewLog } from '#lib/server/db/schema.ts';
import { moveToTrash } from '#lib/server/decks/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Leeches and the weak-spot report over HTTP (US-6, ADR-015).

let dir: TempDir;
let app: AppContext;
const clock = fakeClock('2026-10-12T12:00:00.000Z');

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		log: createLogger({ level: 'debug', write: () => undefined })
	});
	seed('net', 'Networking', [
		{ ...basic('hello', 'Hello interval?', '10 seconds'), tags: ['ospf'] },
		{ id: 'cmd', type: 'typed', front: 'Show routes?', answer: 'show ip route', tags: ['ospf'] },
		basic('fine')
	]);
	seed('other', 'Other', [basic('o1')]);
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

function seed(id: string, title: string, cardsIn: Record<string, unknown>[]) {
	importForSetup(app.db, makeDeck(cardsIn, { id, title }), clock);
}

const pkOf = (key: string) => app.db.select().from(cards).where(eq(cards.key, key)).get()!.pk;

function leech(key: string, lapses = 9, ordinal = 0) {
	app.db
		.update(cardState)
		.set({
			leech: true,
			lapses,
			reps: lapses + 4,
			phase: 2,
			lastReview: '2026-10-11T09:00:00.000Z'
		})
		.where(and(eq(cardState.cardPk, pkOf(key)), eq(cardState.ordinal, ordinal)))
		.run();
}

let counter = 0;
function review(key: string, grade: number, typed: string | null, at = '2026-10-10T10:00:00.000Z') {
	app.db
		.insert(reviewLog)
		.values({
			id: `r-${counter++}`,
			cardPk: pkOf(key),
			ordinal: 0,
			mode: 'review',
			grade,
			preDue: at,
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
			typedAnswer: typed,
			reviewedAt: at
		})
		.run();
}

const url = (path: string) => new URL(`http://tessera.example${path}`);
const errorOf = async (response: Response) =>
	((await response.json()) as { error: { code: string; message: string } }).error;

describe('GET /api/leeches', () => {
	it('is empty when nothing is a leech', async () => {
		const response = handleListLeeches(app, url('/api/leeches'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ leeches: [], weakTags: [], openCount: 0 });
	});

	it('lists leeches with the whole card, the counts, and the wrong answers typed', async () => {
		leech('cmd', 11);
		review('cmd', 1, 'show route');
		const body = (await handleListLeeches(app, url('/api/leeches')).json()) as LeechesResponse;
		expect(body.openCount).toBe(1);
		expect(body.leeches).toHaveLength(1);
		expect(body.leeches[0]).toMatchObject({
			cardPk: pkOf('cmd'),
			ordinal: 0,
			deckId: 'net',
			deckTitle: 'Networking',
			key: 'cmd',
			type: 'typed',
			lapses: 11,
			suspended: false,
			wrongAnswers: ['show route']
		});
		expect(body.leeches[0]!.content).toMatchObject({ answer: 'show ip route' });
	});

	it('includes the weakest tags, and respects the deck filter', async () => {
		for (let i = 0; i < 12; i++) review('hello', i < 6 ? 1 : 3, null);
		const all = (await handleListLeeches(app, url('/api/leeches')).json()) as LeechesResponse;
		expect(all.weakTags[0]).toMatchObject({ tag: 'ospf', reviews: 12, retention: 0.5 });
		const other = (await handleListLeeches(
			app,
			url('/api/leeches?deckId=other')
		).json()) as LeechesResponse;
		expect(other.weakTags).toEqual([]);
	});

	it('is a 404 for a deck that does not exist, is in the Trash, or cannot be an id', async () => {
		moveToTrash(app.db, 'other', clock.now().toISOString());
		for (const id of ['nope', 'other', 'Bad Id!', '..%2fx']) {
			const response = handleListLeeches(app, url(`/api/leeches?deckId=${id}`));
			expect(response.status, id).toBe(404);
		}
	});

	it('is not cached', () => {
		const response = handleListLeeches(app, url('/api/leeches'));
		expect(response.headers.get('content-type')).toContain('application/json');
	});
});

describe('POST /api/leeches/:cardPk/:ordinal/reset', () => {
	it('clears the flag and the lapses, and says so', async () => {
		leech('hello', 10);
		const response = handleResetLeech(app, String(pkOf('hello')), '0', 'req');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reset: true });
		const body = (await handleListLeeches(app, url('/api/leeches')).json()) as LeechesResponse;
		expect(body.leeches).toEqual([]);
	});

	it('is the same answer the second time', () => {
		leech('hello', 10);
		expect(handleResetLeech(app, String(pkOf('hello')), '0', 'req').status).toBe(200);
		expect(handleResetLeech(app, String(pkOf('hello')), '0', 'req').status).toBe(200);
	});

	it.each([
		['an item that does not exist', '99999', '0'],
		['a blank that does not exist', 'PK', '9'],
		['a card number that is not a number', 'abc', '0'],
		['a negative card number', '-1', '0'],
		['a fraction', '1.5', '0'],
		['an exponent', '1e3', '0'],
		['a huge number', '99999999999999999999', '0'],
		['a blank number that is not a number', 'PK', 'x'],
		['an empty card number', '', '0']
	])('is a 404 for %s', async (_label, pk, ordinal) => {
		const response = handleResetLeech(
			app,
			pk === 'PK' ? String(pkOf('hello')) : pk,
			ordinal,
			'req'
		);
		expect(response.status).toBe(404);
		const error = await errorOf(response);
		expect(error.code).toBe('not_found');
		expect(error.message).not.toContain(dir.path);
	});

	it('is a 404 for forms of a real number that are not plain digits, so a path means one thing', () => {
		leech('hello', 10);
		const pk = pkOf('hello');
		for (const form of [
			`${pk}.0`,
			`${pk}e0`,
			` ${pk}`,
			`+${pk}`,
			`0x${pk.toString(16)}`,
			`0000000000${pk}`
		]) {
			expect(handleResetLeech(app, form, '0', 'req').status, form).toBe(404);
			expect(handleSetSuspended(app, form, true, 'req').status, form).toBe(404);
		}
		expect(handleResetLeech(app, String(pk), '0', 'req').status).toBe(200);
	});

	it('is a 404 for an item in a deck in the Trash', () => {
		moveToTrash(app.db, 'other', clock.now().toISOString());
		expect(handleResetLeech(app, String(pkOf('o1')), '0', 'req').status).toBe(404);
	});
});

describe('POST /api/cards/:cardPk/suspend and unsuspend', () => {
	it('suspends a card, and the leech list marks it', async () => {
		leech('hello', 10);
		const response = handleSetSuspended(app, String(pkOf('hello')), true, 'req');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ suspended: true });
		const body = (await handleListLeeches(app, url('/api/leeches')).json()) as LeechesResponse;
		expect(body.leeches[0]).toMatchObject({ key: 'hello', suspended: true });
		expect(body.openCount).toBe(0);
	});

	it('puts it back', async () => {
		handleSetSuspended(app, String(pkOf('hello')), true, 'req');
		const response = handleSetSuspended(app, String(pkOf('hello')), false, 'req');
		expect(await response.json()).toEqual({ suspended: false });
	});

	it.each(['99999', 'abc', '-1', '1.5', '', '99999999999999999999'])(
		'is a 404 for the card %j',
		(pk) => {
			expect(handleSetSuspended(app, pk, true, 'req').status).toBe(404);
		}
	);
});

describe('GET /api/report/weak-spots', () => {
	it('gives Markdown by default, ready to paste, with the card in the format import reads', async () => {
		leech('cmd', 11);
		review('cmd', 1, 'show route');
		const response = handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const text = await response.text();
		expect(text).toContain('# Tessera weak-spot report');
		expect(text).toContain('What I would like you to do');
		expect(text).toContain('"id": "cmd"');
		expect(text).toContain('"type": "typed"');
		expect(text).toContain('"show route"');
		expect(text).toContain('Networking');
	});

	it('points to the schema on the address the request came to', async () => {
		leech('cmd');
		const text = await handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req').text();
		expect(text).toContain('Schema: http://tessera.example/api/schema');
	});

	it('gives JSON when asked, the same facts', async () => {
		leech('cmd', 11);
		const response = handleWeakSpotReport(app, url('/api/report/weak-spots?format=json'), 'req');
		expect(response.headers.get('content-type')).toContain('application/json');
		const body = (await response.json()) as {
			report: string;
			leechCards: { shown: number };
			decks: { document: { cards: { id: string }[] } }[];
		};
		expect(body.report).toBe('tessera-weak-spots');
		expect(body.leechCards.shown).toBe(1);
		expect(body.decks[0]!.document.cards[0]!.id).toBe('cmd');
	});

	it('leaves out a suspended card, which the learner has dealt with', async () => {
		leech('cmd', 11);
		leech('hello', 9);
		handleSetSuspended(app, String(pkOf('cmd')), true, 'req');
		const text = await handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req').text();
		expect(text).toContain('"id": "hello"');
		expect(text).not.toContain('"id": "cmd"');
	});

	it('can be limited to one deck, and names it', async () => {
		leech('cmd');
		leech('o1');
		const text = await handleWeakSpotReport(
			app,
			url('/api/report/weak-spots?deckId=other'),
			'req'
		).text();
		expect(text).toContain('Deck: Other');
		expect(text).toContain('"id": "o1"');
		expect(text).not.toContain('"id": "cmd"');
	});

	it('shows only the tags of the deck it is limited to', async () => {
		for (let i = 0; i < 12; i++) review('hello', i < 6 ? 1 : 3, null);
		leech('o1');
		const all = await handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req').text();
		expect(all).toContain('| ospf |');
		const scoped = await handleWeakSpotReport(
			app,
			url('/api/report/weak-spots?deckId=other'),
			'req'
		).text();
		expect(scoped).not.toContain('| ospf |');
	});

	it('says there is nothing to rewrite, still with a 200, when there are no leeches', async () => {
		const response = handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('No cards are flagged as leeches');
	});

	it.each(['xml', 'MD', '', 'json;x'])('refuses the format %j with a 400', async (format) => {
		const response = handleWeakSpotReport(
			app,
			url(`/api/report/weak-spots?format=${format}`),
			'req'
		);
		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe('bad_request');
	});

	it('accepts md and markdown as names for the same thing', async () => {
		const a = await handleWeakSpotReport(
			app,
			url('/api/report/weak-spots?format=md'),
			'req'
		).text();
		const b = await handleWeakSpotReport(
			app,
			url('/api/report/weak-spots?format=markdown'),
			'req'
		).text();
		expect(a).toBe(b);
	});

	it('is a 404 for an unknown deck, one in the Trash, or an id that cannot be one', () => {
		moveToTrash(app.db, 'other', clock.now().toISOString());
		for (const id of ['nope', 'other', 'Bad%20Id']) {
			expect(
				handleWeakSpotReport(app, url(`/api/report/weak-spots?deckId=${id}`), 'req').status,
				id
			).toBe(404);
		}
	});

	it('does not give away a path from the server', async () => {
		leech('cmd');
		const text = await handleWeakSpotReport(app, url('/api/report/weak-spots'), 'req').text();
		expect(text).not.toContain(dir.path);
	});
});
