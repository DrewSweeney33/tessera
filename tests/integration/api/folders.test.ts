import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	AssignDecksResponse,
	DecksResponse,
	DeleteFolderResponse,
	FolderResponse,
	FolderStatsDto,
	FoldersResponse
} from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import {
	handleAssignDecks,
	handleCreateFolder,
	handleDeleteFolder,
	handleFolderStats,
	handleListFolders,
	handleRenameFolder
} from '#lib/server/api/folders.ts';
import { handleListDecks } from '#lib/server/api/decks.ts';
import { handleStudyNext, handleStudyReview } from '#lib/server/api/study.ts';
import { handleTrashDeck } from '#lib/server/api/trash.ts';
import { getDeck } from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Project folders over HTTP: make, rename, and delete them, put decks in them and take decks out, read their
// statistics, and study one. Folders only label decks, so nothing here may change a card or a review.

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T15:00:00.000Z'),
		rng: () => 0,
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
	for (const [id, title] of [
		['alpha', 'Alpha deck'],
		['beta', 'Beta deck'],
		['gamma', 'Gamma deck']
	] as const) {
		importForSetup(
			app.db,
			makeDeck([basic(`${id}-1`), basic(`${id}-2`)], { id, title }),
			app.clock
		);
	}
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const body = (value: unknown, raw = false) =>
	new Request('http://localhost/api/folders', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (value as string) : JSON.stringify(value)
	});

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

async function make(name: string): Promise<FolderResponse['folder']> {
	const response = await handleCreateFolder(app, body({ name }), 'req');
	expect(response.status).toBe(201);
	return ((await response.json()) as FolderResponse).folder;
}

async function assign(deckIds: string[], folderId: number | null) {
	return handleAssignDecks(app, body({ deckIds, folderId }), 'req');
}

const listed = async () => (await handleListDecks(app).json()) as DecksResponse;

describe('POST /api/folders', () => {
	it('makes a folder and answers 201 with its numbers', async () => {
		const response = await handleCreateFolder(app, body({ name: '  CCNA 200-301 ' }), 'req');
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			folder: {
				id: 1,
				name: 'CCNA 200-301',
				deckCount: 0,
				cardCount: 0,
				counts: { learning: 0, review: 0, new: 0 },
				reviewsToday: 0,
				retention: null
			}
		});
	});

	it('names the field when the name is not valid', async () => {
		for (const [name, code] of [
			['', 'empty'],
			['   ', 'empty'],
			['a\nb', 'control_characters'],
			['x'.repeat(61), 'too_long']
		] as const) {
			const response = await handleCreateFolder(app, body({ name }), 'req');
			expect(response.status).toBe(422);
			const error = await errorOf(response);
			expect(error.code).toBe('validation_failed');
			expect(error.details?.errors).toEqual([expect.objectContaining({ path: 'name', code })]);
		}
	});

	it('refuses a body that is not exactly { name }', async () => {
		for (const value of [{}, { name: 5 }, { name: 'x', extra: 1 }, [], 'text', null]) {
			const response = await handleCreateFolder(app, body(value), 'req');
			expect(response.status).toBe(422);
		}
		const broken = await handleCreateFolder(app, body('{not json', true), 'req');
		expect(broken.status).toBe(400);
		expect(((await handleListFolders(app).json()) as FoldersResponse).folders).toEqual([]);
	});

	it('answers 409 for a name that is taken, ignoring case, and points at the field', async () => {
		await make('CCNA');
		const response = await handleCreateFolder(app, body({ name: 'ccna' }), 'req');
		expect(response.status).toBe(409);
		const error = await errorOf(response);
		expect(error.code).toBe('conflict');
		expect(error.details?.errors).toEqual([
			expect.objectContaining({ path: 'name', code: 'name_taken' })
		]);
	});

	it('logs the id and never the name', async () => {
		await make('Private plans');
		expect(logged.join('\n')).toContain('folder created');
		expect(logged.join('\n')).not.toContain('Private plans');
	});
});

describe('GET /api/folders and GET /api/decks', () => {
	it('lists folders by name with deck and card counts', async () => {
		const b = await make('B folder');
		await make('A folder');
		await assign(['alpha', 'beta'], b.id);
		const { folders } = (await handleListFolders(app).json()) as FoldersResponse;
		expect(folders.map((f) => [f.name, f.deckCount, f.cardCount, f.counts.new])).toEqual([
			['A folder', 0, 0, 0],
			['B folder', 2, 4, 4]
		]);
	});

	it('tells the deck list which folder each deck is in, and lists the folders with it', async () => {
		const course = await make('Course');
		await assign(['beta'], course.id);
		const { decks, folders } = await listed();
		expect(folders).toHaveLength(1);
		expect(decks.map((d) => [d.id, d.folderId])).toEqual([
			['alpha', null],
			['beta', course.id],
			['gamma', null]
		]);
	});
});

describe('PUT /api/folders/:id', () => {
	it('renames the folder', async () => {
		const folder = await make('Old name');
		const response = await handleRenameFolder(
			app,
			String(folder.id),
			body({ name: 'New name' }),
			'req'
		);
		expect(response.status).toBe(200);
		expect(((await response.json()) as FolderResponse).folder).toMatchObject({
			id: folder.id,
			name: 'New name'
		});
	});

	it('answers 409 for another folder name and 422 for a bad name', async () => {
		const a = await make('A');
		await make('B');
		expect((await handleRenameFolder(app, String(a.id), body({ name: 'b' }), 'req')).status).toBe(
			409
		);
		expect((await handleRenameFolder(app, String(a.id), body({ name: '' }), 'req')).status).toBe(
			422
		);
	});

	it('answers 404 for a folder that is not there or an id that cannot be one', async () => {
		for (const id of ['99', '0', '-1', '1.5', 'abc', '', '12345678901', '01']) {
			const response = await handleRenameFolder(app, id, body({ name: 'X' }), 'req');
			expect(response.status).toBe(404);
			expect((await errorOf(response)).message).toBe('There is no such folder.');
		}
	});
});

describe('DELETE /api/folders/:id', () => {
	it('deletes the folder, ungroups its decks, and says how many', async () => {
		const folder = await make('Course');
		await assign(['alpha', 'beta'], folder.id);
		const response = handleDeleteFolder(app, String(folder.id), 'req');
		expect(response.status).toBe(200);
		expect(((await response.json()) as DeleteFolderResponse).deleted).toEqual({
			id: folder.id,
			name: 'Course',
			decks: 2
		});
		const { decks, folders } = await listed();
		expect(folders).toEqual([]);
		expect(decks).toHaveLength(3);
		expect(decks.every((d) => d.folderId === null)).toBe(true);
		expect(decks.map((d) => d.cardCount)).toEqual([2, 2, 2]);
	});

	it('answers 404 the second time, and for ids that cannot be folders', async () => {
		const folder = await make('Course');
		expect(handleDeleteFolder(app, String(folder.id), 'req').status).toBe(200);
		expect(handleDeleteFolder(app, String(folder.id), 'req').status).toBe(404);
		expect(handleDeleteFolder(app, 'x', 'req').status).toBe(404);
	});
});

describe('PUT /api/folder-assignments', () => {
	it('puts decks in a folder and takes them out', async () => {
		const folder = await make('Course');
		const moved = await assign(['alpha', 'gamma'], folder.id);
		expect(moved.status).toBe(200);
		expect((await moved.json()) as AssignDecksResponse).toEqual({ folderId: folder.id, moved: 2 });
		expect(getDeck(app.db, 'alpha')?.folderId).toBe(folder.id);

		const out = await assign(['alpha'], null);
		expect((await out.json()) as AssignDecksResponse).toEqual({ folderId: null, moved: 1 });
		expect(getDeck(app.db, 'alpha')?.folderId).toBeNull();
		expect(getDeck(app.db, 'gamma')?.folderId).toBe(folder.id);
	});

	it('changes nothing when one deck or the folder is unknown', async () => {
		const folder = await make('Course');
		const missingDeck = await assign(['alpha', 'nope'], folder.id);
		expect(missingDeck.status).toBe(404);
		expect((await errorOf(missingDeck)).details?.errors).toEqual([
			expect.objectContaining({ path: 'deckIds', code: 'not_found' })
		]);
		expect(getDeck(app.db, 'alpha')?.folderId).toBeNull();
		expect((await assign(['alpha'], 999)).status).toBe(404);
		expect((await assign(['Not A Deck Id'], folder.id)).status).toBe(404);
	});

	it('refuses a deck in the Trash like any other unknown deck', async () => {
		const folder = await make('Course');
		handleTrashDeck(app, 'alpha', 'req');
		expect((await assign(['alpha'], folder.id)).status).toBe(404);
	});

	it('refuses a malformed request', async () => {
		for (const value of [
			{},
			{ deckIds: [], folderId: null },
			{ deckIds: ['alpha'] },
			{ deckIds: 'alpha', folderId: null },
			{ deckIds: ['alpha'], folderId: '1' },
			{ deckIds: ['alpha'], folderId: 0 },
			{ deckIds: ['alpha'], folderId: 1.5 },
			{ deckIds: [1], folderId: null },
			{ deckIds: ['alpha'], folderId: null, extra: true },
			{ deckIds: Array.from({ length: 501 }, (_, i) => `d${i}`), folderId: null }
		]) {
			const response = await handleAssignDecks(app, body(value), 'req');
			expect(response.status, JSON.stringify(value).slice(0, 80)).toBe(422);
		}
	});

	it('leaves the decks and cards exactly as they were', async () => {
		const before = await listed();
		const folder = await make('Course');
		await assign(['alpha', 'beta', 'gamma'], folder.id);
		const after = await listed();
		const strip = (decks: DecksResponse['decks']) =>
			decks.map((deck) => ({ ...deck, folderId: null }));
		expect(strip(after.decks)).toEqual(strip(before.decks));
	});
});

describe('GET /api/folders/:id/stats', () => {
	it('answers with the statistics of the folder', async () => {
		const folder = await make('Course');
		await assign(['alpha', 'beta'], folder.id);
		const response = handleFolderStats(app, String(folder.id), 'req');
		expect(response.status).toBe(200);
		const stats = (await response.json()) as FolderStatsDto;
		expect(stats.folder).toMatchObject({ id: folder.id, deckCount: 2, cardCount: 4 });
		expect(stats.items).toEqual({ new: 4, learning: 0, review: 0, suspended: 0 });
		expect(stats.days).toHaveLength(14);
		expect(stats.days.at(-1)?.day).toBe('2026-10-12');
		expect(stats.streakDays).toBe(0);
	});

	it('answers 404 for a missing folder or a bad id', async () => {
		expect(handleFolderStats(app, '5', 'req').status).toBe(404);
		expect(handleFolderStats(app, 'x', 'req').status).toBe(404);
	});
});

describe('studying one folder over HTTP', () => {
	const next = async (query: string) => {
		const response = handleStudyNext(
			app,
			new URL(`http://localhost/api/study/next${query}`),
			'req'
		);
		return { response, json: await response.json() };
	};

	it('serves only cards from decks in the folder', async () => {
		const folder = await make('Course');
		await assign(['beta'], folder.id);
		const { response, json } = await next(`?folderId=${folder.id}`);
		expect(response.status).toBe(200);
		expect(json.item.deckId).toBe('beta');
		expect(json.counts).toEqual({ learning: 0, review: 0, new: 2 });
	});

	it('is done at once for a folder with no decks', async () => {
		const folder = await make('Empty');
		const { response, json } = await next(`?folderId=${folder.id}`);
		expect(response.status).toBe(200);
		expect(json).toEqual({
			done: true,
			waitingUntil: null,
			counts: { learning: 0, review: 0, new: 0 }
		});
	});

	it('answers 404 for a missing folder and 400 for a folder id that is not one', async () => {
		expect((await next('?folderId=77')).response.status).toBe(404);
		for (const bad of ['abc', '0', '1.5', '-2']) {
			expect((await next(`?folderId=${bad}`)).response.status, bad).toBe(400);
		}
	});

	it('refuses to study a deck and a folder together', async () => {
		const folder = await make('Course');
		const { response, json } = await next(`?deckId=alpha&folderId=${folder.id}`);
		expect(response.status).toBe(400);
		expect(json.error.message).toBe('Study one deck or one folder, not both.');
	});

	it('answers a review and serves the next card from the same folder', async () => {
		const folder = await make('Course');
		await assign(['gamma'], folder.id);
		const first = (await next(`?folderId=${folder.id}`)).json;
		const response = await handleStudyReview(
			app,
			new Request('http://localhost/api/study/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					reviewId: 'folder-review-1',
					cardPk: first.item.cardPk,
					ordinal: first.item.ordinal,
					grade: 3,
					servedAt: first.item.servedAt,
					folderId: folder.id
				})
			}),
			'req'
		);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.result.cardPk).toBe(first.item.cardPk);
		expect(json.next.item.deckId).toBe('gamma');
		expect(json.next.item.cardPk).not.toBe(first.item.cardPk);
	});

	it('refuses a review that names both a deck and a folder, or a folder that is not there', async () => {
		const folder = await make('Course');
		const review = (extra: Record<string, unknown>) =>
			handleStudyReview(
				app,
				new Request('http://localhost/api/study/review', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						reviewId: 'folder-review-2',
						cardPk: 1,
						ordinal: 0,
						grade: 3,
						servedAt: '2026-10-12T15:00:00.000Z',
						...extra
					})
				}),
				'req'
			);
		expect((await review({ deckId: 'alpha', folderId: folder.id })).status).toBe(400);
		expect((await review({ folderId: 404 })).status).toBe(404);
		expect((await review({ folderId: 'x' })).status).toBe(422);
	});
});
