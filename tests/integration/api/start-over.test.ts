import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { StartOverResponse } from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleStartOver } from '#lib/server/api/start-over.ts';
import { handleTrashDeck } from '#lib/server/api/trash.ts';
import { cards, cardState } from '#lib/server/db/schema.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { listStatesForDeck } from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Start over over HTTP (US-14, ADR-013): POST /api/decks/:id/start-over with the deck title typed.

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T12:00:00.000Z'),
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
	for (const [id, title] of [
		['alpha', 'Alpha deck'],
		['beta', 'Beta deck']
	] as const) {
		const result = commitImport(
			app.db,
			makeDeck([basic(`${id}-1`), basic(`${id}-2`)], { id, title }),
			{ archiveMissing: false, format: 'json' },
			app.clock
		);
		if (!result.ok) throw new Error('setup import failed');
	}
	// Alpha has been studied.
	const alphaCards = app.db.select().from(cards).where(eq(cards.deckId, 'alpha')).all();
	for (const card of alphaCards) {
		app.db
			.update(cardState)
			.set({ phase: 2, reps: 4, stability: 9, due: '2026-12-01T00:00:00.000Z' })
			.where(eq(cardState.cardPk, card.pk))
			.run();
	}
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const request = (body: unknown, raw = false) =>
	new Request('http://localhost/api/decks/x/start-over', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (body as string) : JSON.stringify(body)
	});
const startOver = (id: string, body: unknown, raw = false) =>
	handleStartOver(app, id, request(body, raw), 'req');
const errorOf = async (response: Response) =>
	(
		(await response.json()) as {
			error: { code: string; message: string; details?: unknown };
		}
	).error;

describe('POST /api/decks/:id/start-over', () => {
	it('puts the deck back to new when its title is typed, and answers with the deck as the list shows it', async () => {
		const response = await startOver('alpha', { confirmTitle: 'Alpha deck' });
		expect(response.status).toBe(200);
		const body = (await response.json()) as StartOverResponse;
		expect(body.reset).toMatchObject({ deckId: 'alpha', items: 2, reviews: 0 });
		expect(body.reset.snapshot.name).toMatch(/^pre-reset-alpha-.*\.db$/);
		expect(existsSync(join(dir.path, 'backups', body.reset.snapshot.name))).toBe(true);
		expect(body.deck).toMatchObject({ id: 'alpha', cardCount: 2, counts: { new: 2 } });
		expect(listStatesForDeck(app.db, 'alpha').every((s) => s.phase === 0 && s.reps === 0)).toBe(
			true
		);
	});

	it('names the title field when the wrong title is typed, and changes nothing', async () => {
		const response = await startOver('alpha', { confirmTitle: 'alpha' });
		expect(response.status).toBe(422);
		const error = await errorOf(response);
		expect(error.code).toBe('validation_failed');
		expect(error.details).toMatchObject({ errors: [{ path: 'confirmTitle' }] });
		expect(listStatesForDeck(app.db, 'alpha').every((s) => s.reps === 4)).toBe(true);
		expect(existsSync(join(dir.path, 'backups', 'x'))).toBe(false);
	});

	it.each([
		['a missing title', {}],
		['a title that is not text', { confirmTitle: 5 }],
		['a title that is null', { confirmTitle: null }],
		['a field it does not know', { confirmTitle: 'Alpha deck', force: true }]
	])('refuses %s with a 422 that names the field, and changes nothing', async (_label, body) => {
		const response = await startOver('alpha', body);
		expect(response.status).toBe(422);
		expect((await errorOf(response)).details).toMatchObject({ errors: [{}] });
		expect(listStatesForDeck(app.db, 'alpha').every((s) => s.reps === 4)).toBe(true);
	});

	it.each([
		['no body', ''],
		['text that is not JSON', 'nope'],
		['a JSON array', '[]']
	])('refuses %s', async (_label, raw) => {
		const response = await startOver('alpha', raw, true);
		expect([400, 422]).toContain(response.status);
		expect(listStatesForDeck(app.db, 'alpha').every((s) => s.reps === 4)).toBe(true);
	});

	it('is a 404 for an unknown deck, an id that cannot be one, and a deck in the Trash', async () => {
		expect((await startOver('nope', { confirmTitle: 'x' })).status).toBe(404);
		const bad = await startOver('Bad Id!', { confirmTitle: 'x' });
		expect(bad.status).toBe(404);
		expect((await errorOf(bad)).message).toBe('There is no such deck.');
		await handleTrashDeck(app, 'alpha', 'req');
		expect((await startOver('alpha', { confirmTitle: 'Alpha deck' })).status).toBe(404);
		expect(listStatesForDeck(app.db, 'alpha').every((s) => s.reps === 4)).toBe(true);
	});

	it('refuses a body over the small limit', async () => {
		const response = await startOver('alpha', { confirmTitle: 'x'.repeat(20_000) });
		expect(response.status).toBe(413);
	});

	it('leaves other decks alone', async () => {
		const before = listStatesForDeck(app.db, 'beta');
		await startOver('alpha', { confirmTitle: 'Alpha deck' });
		expect(listStatesForDeck(app.db, 'beta')).toEqual(before);
	});

	it('logs the deck id and the counts, and never the title', async () => {
		await startOver('alpha', { confirmTitle: 'Alpha deck' });
		const lines = logged.join('\n');
		expect(lines).toContain('alpha');
		expect(lines).not.toContain('Alpha deck');
	});
});
