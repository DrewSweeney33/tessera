import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleCreateDeck, handleListDecks } from '#lib/server/api/decks.ts';
import { handleExportDeck } from '#lib/server/api/export.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { createDeck } from '#lib/server/decks/index.ts';
import { decks } from '#lib/server/db/schema.ts';
import { getDeck, listDecks } from '#lib/server/repos/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Creating a deck by hand (US-11, ADR-013). The deck file format needs at least one card, so a new deck is made
// directly, with the same rules for its id, title, description, and tags as an imported deck.

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];
const NOW = '2026-10-12T12:00:00.000Z';

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	app = createApp({
		config: config.value,
		clock: fakeClock(NOW),
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

function post(body: unknown): Request {
	return new Request('http://localhost/api/decks', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

const create = (body: unknown) => handleCreateDeck(app, post(body), 'req-1');

describe('createDeck (the service)', () => {
	it('makes a deck with a title, a description, and tags, and no cards', () => {
		const made = createDeck(
			app.db,
			{
				id: 'ospf',
				title: ' OSPF notes ',
				description: 'Areas and LSAs',
				tags: ['ccna', 'routing']
			},
			NOW
		);
		expect(made.ok).toBe(true);
		const row = getDeck(app.db, 'ospf')!;
		expect(row).toMatchObject({
			id: 'ospf',
			title: 'OSPF notes',
			description: 'Areas and LSAs',
			tags: ['ccna', 'routing'],
			archived: false,
			createdAt: NOW,
			updatedAt: NOW
		});
	});

	it('stores no description and no tags as empty, not as made-up text', () => {
		createDeck(app.db, { id: 'plain', title: 'Plain' }, NOW);
		expect(getDeck(app.db, 'plain')).toMatchObject({ description: null, tags: [] });
	});

	it('makes the id from the title when none is given, and a later one with the same title gets a number', () => {
		const ids = ['Same title', 'Same title', 'Same title'].map((title) => {
			const made = createDeck(app.db, { title }, NOW);
			if (!made.ok) throw new Error('should have been created');
			return made.value.id;
		});
		expect(ids).toEqual(['same-title', 'same-title-2', 'same-title-3']);
	});

	it('keeps the generated id within the length limit, number included', () => {
		const long = 'a'.repeat(100);
		const first = createDeck(app.db, { title: long }, NOW);
		const second = createDeck(app.db, { title: long }, NOW);
		if (!first.ok || !second.ok) throw new Error('should have been created');
		expect(first.value.id).toHaveLength(64);
		expect(second.value.id.length).toBeLessThanOrEqual(64);
		expect(second.value.id).not.toBe(first.value.id);
		expect(second.value.id).toMatch(/-2$/);
	});

	it('refuses an id that is taken, and names the id field', () => {
		createDeck(app.db, { id: 'taken', title: 'First' }, NOW);
		const again = createDeck(app.db, { id: 'taken', title: 'Second' }, NOW);
		expect(again.ok).toBe(false);
		if (again.ok) return;
		expect(again.error.kind).toBe('conflict');
		if (again.error.kind !== 'conflict') return;
		expect(again.error.error).toMatchObject({ path: 'id', code: 'id_taken' });
		expect(getDeck(app.db, 'taken')!.title).toBe('First');
	});

	it('says an id is in the Trash, and does not bring that deck back', () => {
		createDeck(app.db, { id: 'old', title: 'Old' }, NOW);
		app.db.update(decks).set({ archived: true }).where(eq(decks.id, 'old')).run();
		const again = createDeck(app.db, { id: 'old', title: 'New' }, NOW);
		expect(again.ok).toBe(false);
		if (again.ok || again.error.kind !== 'conflict') throw new Error('expected a conflict');
		expect(again.error.error.code).toBe('id_in_trash');
		expect(again.error.error.message).toMatch(/Trash/);
		expect(getDeck(app.db, 'old')).toMatchObject({ title: 'Old', archived: true });
	});

	it('does not reuse the id of a deck in the Trash when it makes one from a title', () => {
		createDeck(app.db, { title: 'Reuse me' }, NOW);
		app.db.update(decks).set({ archived: true }).where(eq(decks.id, 'reuse-me')).run();
		const next = createDeck(app.db, { title: 'Reuse me' }, NOW);
		if (!next.ok) throw new Error('should have been created');
		expect(next.value.id).toBe('reuse-me-2');
	});

	it.each([
		['a blank title', { id: 'x', title: '   ' }, 'title'],
		['no title', { id: 'x' }, 'title'],
		['a title that is too long', { id: 'x', title: 't'.repeat(201) }, 'title'],
		['an id with capitals', { id: 'Bad', title: 'T' }, 'id'],
		['an id with a slash', { id: 'a/b', title: 'T' }, 'id'],
		['an id that is too long', { id: 'a'.repeat(65), title: 'T' }, 'id'],
		[
			'a description that is too long',
			{ id: 'x', title: 'T', description: 'd'.repeat(2001) },
			'description'
		],
		[
			'too many tags',
			{ id: 'x', title: 'T', tags: Array.from({ length: 33 }, (_, i) => `t${i}`) },
			'tags'
		],
		['a tag with a comma', { id: 'x', title: 'T', tags: ['a,b'] }, 'tags[0]'],
		['a tag that starts with a space', { id: 'x', title: 'T', tags: [' a'] }, 'tags[0]'],
		['a field it does not know', { id: 'x', title: 'T', cards: [] }, 'cards'],
		['the wrong type', { id: 'x', title: 42 }, 'title']
	])('refuses %s, naming the field, and creates nothing', (_label, input, path) => {
		const made = createDeck(app.db, input, NOW);
		expect(made.ok).toBe(false);
		if (made.ok || made.error.kind !== 'invalid') throw new Error('expected a validation error');
		expect(made.error.errors.map((e) => e.path)).toContain(path);
		expect(listDecks(app.db, { includeArchived: true })).toEqual([]);
	});

	it('refuses something that is not an object at all', () => {
		for (const input of [null, 'text', 5, [], undefined]) {
			expect(createDeck(app.db, input, NOW).ok, String(input)).toBe(false);
		}
	});
});

describe('POST /api/decks', () => {
	it('answers 201 with the new deck as the home page would list it', async () => {
		const response = await create({ title: 'CCNA', tags: ['net'] });
		expect(response.status).toBe(201);
		const { deck } = await response.json();
		expect(deck).toMatchObject({
			id: 'ccna',
			title: 'CCNA',
			description: null,
			tags: ['net'],
			cardCount: 0
		});
		expect(deck.counts).toMatchObject({ new: 0, learning: 0, review: 0 });
		const list = await handleListDecks(app).json();
		expect(list.decks.map((d: { id: string }) => d.id)).toEqual(['ccna']);
	});

	it('answers 409 for a taken id, with the field and a code a form can show', async () => {
		await create({ id: 'taken', title: 'First' });
		const response = await create({ id: 'taken', title: 'Second' });
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.error.code).toBe('conflict');
		expect(body.error.details.errors[0]).toMatchObject({ path: 'id', code: 'id_taken' });
	});

	it('answers 422 for an invalid deck and names every field that is wrong', async () => {
		const response = await create({ id: 'BAD ID', title: '', tags: ['a,b'], extra: 1 });
		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe('validation_failed');
		const paths = body.error.details.errors.map((e: { path: string }) => e.path);
		expect(paths).toEqual(expect.arrayContaining(['id', 'title', 'tags[0]', 'extra']));
	});

	it('answers 400 for a body that is not JSON, and 413 for one that is far too big', async () => {
		const notJson = await create('{not json');
		expect(notJson.status).toBe(400);
		const tooBig = await create(JSON.stringify({ title: 'x'.repeat(40_000) }));
		expect(tooBig.status).toBe(413);
		expect(listDecks(app.db, { includeArchived: true })).toEqual([]);
	});

	it('does not write a deck title to the log', async () => {
		const secret = 'ZQXJ-DECK-TITLE-SECRET-3390';
		await create({ title: secret });
		expect(logged.join('\n')).not.toContain(secret);
	});

	it('makes a deck that import accepts cards for, and that then exports', async () => {
		await create({ id: 'fresh', title: 'Fresh' });
		const empty = handleExportDeck(
			app,
			'fresh',
			new URL('http://localhost/api/decks/fresh/export'),
			'r'
		);
		expect(empty.status).toBe(409);
		const imported = await handleImport(
			app,
			new Request('http://localhost/api/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					tessera: 1,
					deck: { id: 'fresh', title: 'Fresh' },
					cards: [{ id: 'a', type: 'basic', front: 'Q', back: 'A' }]
				})
			}),
			'req-import'
		);
		expect(imported.status).toBe(200);
		const exported = handleExportDeck(
			app,
			'fresh',
			new URL('http://localhost/api/decks/fresh/export'),
			'r'
		);
		expect(exported.status).toBe(200);
		expect(JSON.parse(await exported.text()).cards).toHaveLength(1);
	});
});
