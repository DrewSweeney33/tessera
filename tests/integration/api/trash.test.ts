import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
	DeleteDeckResponse,
	RestoreDeckResponse,
	TrashDeckResponse,
	TrashResponse
} from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleGetDeck } from '#lib/server/api/deck.ts';
import { handleListDecks } from '#lib/server/api/decks.ts';
import { handleExportDeck } from '#lib/server/api/export.ts';
import {
	handleDeleteForever,
	handleListTrash,
	handleRestoreDeck,
	handleTrashDeck
} from '#lib/server/api/trash.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { getDeck } from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The Trash over HTTP (US-13, ADR-013): move a deck there, restore it, and delete it for good with the title typed.

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
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const post = (body: unknown, raw = false) =>
	new Request('http://localhost/api/decks/x/action', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (body as string) : JSON.stringify(body)
	});

const trash = (id: string) => handleTrashDeck(app, id, 'req');
const restore = (id: string) => handleRestoreDeck(app, id, 'req');
const remove = (id: string, body: unknown, raw = false) =>
	handleDeleteForever(app, id, post(body, raw), 'req');
const errorOf = async (response: Response) =>
	(
		(await response.json()) as {
			error: { code: string; message: string; details?: unknown };
		}
	).error;

describe('POST /api/decks/:id/trash', () => {
	it('moves the deck to the Trash and says what is in it', async () => {
		const response = await trash('alpha');
		expect(response.status).toBe(200);
		const body = (await response.json()) as TrashDeckResponse;
		expect(body.deck).toMatchObject({
			id: 'alpha',
			title: 'Alpha deck',
			cardCount: 2,
			reviewCount: 0,
			trashedAt: '2026-10-12T12:00:00.000Z'
		});
		expect(getDeck(app.db, 'alpha')?.archived).toBe(true);
	});

	it('takes the deck off the list, and out of every other route', async () => {
		await trash('alpha');
		const list = (await handleListDecks(app).json()) as { decks: { id: string }[] };
		expect(list.decks.map((d) => d.id)).toEqual(['beta']);
		expect(handleGetDeck(app, 'alpha', 'req').status).toBe(404);
		expect(handleExportDeck(app, 'alpha', new URL('http://localhost/x'), 'req').status).toBe(404);
	});

	it('is the same 404 for an unknown deck and for an id that cannot be a deck id', async () => {
		const unknown = await trash('nope');
		expect(unknown.status).toBe(404);
		expect((await errorOf(unknown)).code).toBe('not_found');
		const bad = await trash('Bad Id!');
		expect(bad.status).toBe(404);
		expect((await errorOf(bad)).message).toBe('There is no such deck.');
	});

	it('answers a second request the same way, so a double click is harmless', async () => {
		expect((await trash('alpha')).status).toBe(200);
		expect((await trash('alpha')).status).toBe(200);
	});
});

describe('GET /api/trash', () => {
	it('lists the decks in the Trash, and nothing else', async () => {
		expect(((await handleListTrash(app).json()) as TrashResponse).decks).toEqual([]);
		await trash('beta');
		const body = (await handleListTrash(app).json()) as TrashResponse;
		expect(body.decks.map((d) => d.id)).toEqual(['beta']);
	});
});

describe('POST /api/decks/:id/restore', () => {
	it('puts the deck back on the list with its counts', async () => {
		await trash('alpha');
		const response = await restore('alpha');
		expect(response.status).toBe(200);
		const body = (await response.json()) as RestoreDeckResponse;
		expect(body.deck).toMatchObject({ id: 'alpha', cardCount: 2, counts: { new: 2 } });
		expect(getDeck(app.db, 'alpha')?.archived).toBe(false);
	});

	it('is a 404 for an unknown deck', async () => {
		expect((await restore('nope')).status).toBe(404);
		expect((await restore('Bad Id!')).status).toBe(404);
	});
});

describe('POST /api/decks/:id/delete-forever', () => {
	it('deletes a deck in the Trash when its title is typed, and says what went and where the copy is', async () => {
		await trash('alpha');
		const response = await remove('alpha', { confirmTitle: 'Alpha deck' });
		expect(response.status).toBe(200);
		const body = (await response.json()) as DeleteDeckResponse;
		expect(body.deleted).toMatchObject({
			deckId: 'alpha',
			title: 'Alpha deck',
			cards: 2,
			reviews: 0
		});
		expect(body.deleted.snapshot.name).toMatch(/^pre-delete-alpha-.*\.db$/);
		expect(existsSync(join(dir.path, 'backups', body.deleted.snapshot.name))).toBe(true);
		expect(getDeck(app.db, 'alpha')).toBeUndefined();
		expect(getDeck(app.db, 'beta')).toBeDefined();
	});

	it('names the title field when the wrong title is typed, and deletes nothing', async () => {
		await trash('alpha');
		const response = await remove('alpha', { confirmTitle: 'alpha' });
		expect(response.status).toBe(422);
		const error = await errorOf(response);
		expect(error.code).toBe('validation_failed');
		expect(error.details).toMatchObject({ errors: [{ path: 'confirmTitle' }] });
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it('wants the deck to be in the Trash first', async () => {
		const response = await remove('alpha', { confirmTitle: 'Alpha deck' });
		expect(response.status).toBe(409);
		expect((await errorOf(response)).message).toMatch(/Trash/);
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it.each([
		['no body', ''],
		['text that is not JSON', 'nope'],
		['a JSON array', '[]']
	])('refuses %s', async (_label, raw) => {
		await trash('alpha');
		const response = await remove('alpha', raw, true);
		expect([400, 422]).toContain(response.status);
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it.each([
		['a missing title', {}],
		['a title that is not text', { confirmTitle: 5 }],
		['a title that is null', { confirmTitle: null }]
	])('refuses %s with a 422 that names the field', async (_label, body) => {
		await trash('alpha');
		const response = await remove('alpha', body);
		expect(response.status).toBe(422);
		expect((await errorOf(response)).details).toMatchObject({
			errors: [{ path: 'confirmTitle' }]
		});
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it('refuses a field it does not know, like every other write, and deletes nothing', async () => {
		await trash('alpha');
		const response = await remove('alpha', { confirmTitle: 'Alpha deck', force: true });
		expect(response.status).toBe(422);
		expect((await errorOf(response)).details).toMatchObject({
			errors: [{ code: 'unknown_field' }]
		});
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it('is a 404 for an unknown deck and for an id that cannot be one', async () => {
		expect((await remove('nope', { confirmTitle: 'x' })).status).toBe(404);
		expect((await remove('Bad Id!', { confirmTitle: 'x' })).status).toBe(404);
	});

	it('refuses a body over the small limit', async () => {
		await trash('alpha');
		const response = await remove('alpha', { confirmTitle: 'x'.repeat(20_000) });
		expect(response.status).toBe(413);
		expect(getDeck(app.db, 'alpha')).toBeDefined();
	});

	it('logs the deck id and the copy, and never the title', async () => {
		await trash('alpha');
		await remove('alpha', { confirmTitle: 'Alpha deck' });
		const lines = logged.join('\n');
		expect(lines).toContain('alpha');
		expect(lines).not.toContain('Alpha deck');
	});
});
