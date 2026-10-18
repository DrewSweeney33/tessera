import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	BackupsResponse,
	CreateBackupResponse,
	DeleteBackupResponse
} from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import {
	handleCreateBackup,
	handleDeleteBackup,
	handleDownloadBackup,
	handleListBackups
} from '#lib/server/api/backups.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// The Backups routes (US-15, ADR-014): back up now, list, download, delete. A backup is named by its file name and
// never by a path, and only a file the listing would show can be downloaded or deleted.

let dir: TempDir;
let app: AppContext;
let clock: FakeClock;
const logged: string[] = [];

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	clock = fakeClock('2026-10-12T12:00:00.000Z');
	app = createApp({
		config: config.value,
		clock,
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
	importForSetup(app.db, makeDeck([basic('a'), basic('b')], { id: 'kept', title: 'Kept' }), clock);
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const backupsDir = () => join(dir.path, 'backups');
const errorOf = async (response: Response) =>
	((await response.json()) as { error: { code: string; message: string } }).error;
const create = async () => {
	const response = handleCreateBackup(app, 'req');
	return (await response.json()) as CreateBackupResponse;
};

describe('POST /api/backups', () => {
	it('takes a backup now, names it, and the copy is a working database with the data in it', async () => {
		const response = handleCreateBackup(app, 'req');
		expect(response.status).toBe(201);
		const { backup } = (await response.json()) as CreateBackupResponse;
		expect(backup).toMatchObject({ kind: 'manual' });
		expect(backup.name).toMatch(/^manual-2026-10-12T12-00-00-000Z\.db$/);
		expect(backup.size).toBeGreaterThan(0);

		const copy = new Database(join(backupsDir(), backup.name), { readonly: true });
		try {
			expect(copy.prepare('select title from decks').all()).toEqual([{ title: 'Kept' }]);
		} finally {
			copy.close();
		}
	});

	it('does not overwrite an earlier backup taken in the same moment', async () => {
		const first = await create();
		const second = await create();
		expect(second.backup.name).not.toBe(first.backup.name);
		expect(existsSync(join(backupsDir(), first.backup.name))).toBe(true);
	});

	it('logs the name of the copy and nothing from inside the data', async () => {
		const { backup } = await create();
		const lines = logged.join('\n');
		expect(lines).toContain(backup.name);
		expect(lines).not.toContain('Kept');
	});
});

describe('GET /api/backups', () => {
	it('is empty before there is any backup', async () => {
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.backups).toEqual([]);
	});

	it('lists backups newest first with their kind, size, and time', async () => {
		const a = await create();
		clock.advance(60_000);
		const b = await create();
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.backups.map((x) => x.name)).toEqual([b.backup.name, a.backup.name]);
		expect(body.backups[0]).toMatchObject({ kind: 'manual' });
		expect(body.backups[0]!.size).toBeGreaterThan(0);
	});

	it('shows the copies the app takes itself, in words the page can use', async () => {
		writeFileSync(join(backupsDir(), 'pre-migrate-2026-10-01T00-00-00-000Z.db'), 'x');
		writeFileSync(join(backupsDir(), 'pre-delete-kept-2026-10-02T00-00-00-000Z.db'), 'x');
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.backups.map((x) => x.kind).sort()).toEqual(['pre-delete', 'pre-migrate']);
	});

	it('leaves out anything that is not a backup it would serve', async () => {
		mkdirSync(join(backupsDir(), 'sub.db'));
		writeFileSync(join(backupsDir(), 'notes.txt'), 'x');
		writeFileSync(join(backupsDir(), '.hidden.db'), 'x');
		writeFileSync(join(backupsDir(), 'has space.db'), 'x');
		writeFileSync(join(backupsDir(), 'tessera.db'), 'x');
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.backups).toEqual([]);
	});

	it('is not cached and carries no path', async () => {
		await create();
		const response = handleListBackups(app);
		const text = await response.text();
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(text).not.toContain(dir.path);
	});
});

describe('GET /api/backups/:name', () => {
	it('sends the file byte for byte as a download with its own name', async () => {
		const { backup } = await create();
		const response = handleDownloadBackup(app, backup.name, 'req');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-disposition')).toBe(
			`attachment; filename="${backup.name}"`
		);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-length')).toBe(String(backup.size));
		expect(response.headers.get('cache-control')).toBe('no-store');
		const sent = Buffer.from(await response.arrayBuffer());
		expect(sent.equals(readFileSync(join(backupsDir(), backup.name)))).toBe(true);
	});

	it.each([
		'../tessera.db',
		'..\\tessera.db',
		'..%2ftessera.db',
		'tessera.db',
		'tessera.db-wal',
		'sub/x.db',
		'/etc/passwd',
		'C:\\Windows\\win.ini',
		'',
		'.',
		'..',
		'\u0000.db',
		'x'.repeat(200) + '.db',
		'notes.txt',
		'nothing-here.db',
		'<script>alert(1)</script>.db'
	])('is the same 404 for the name %j, and never leaks a path or file', async (name) => {
		writeFileSync(join(backupsDir(), 'notes.txt'), 'secret notes');
		const response = handleDownloadBackup(app, name, 'req');
		expect(response.status).toBe(404);
		const text = await response.text();
		expect(text).not.toContain('secret notes');
		expect(text).not.toContain(dir.path);
		expect(text).not.toContain('<script');
		expect(JSON.parse(text).error.code).toBe('not_found');
	});

	it('never serves the live database, even by a name that looks like a backup', async () => {
		const response = handleDownloadBackup(app, '../tessera.db', 'req');
		expect(response.status).toBe(404);
	});
});

describe('DELETE /api/backups/:name', () => {
	it('removes one backup and leaves the others and the live database', async () => {
		const a = await create();
		clock.advance(1000);
		const b = await create();
		const response = handleDeleteBackup(app, a.backup.name, 'req');
		expect(response.status).toBe(200);
		expect(((await response.json()) as DeleteBackupResponse).deleted).toBe(a.backup.name);
		expect(existsSync(join(backupsDir(), a.backup.name))).toBe(false);
		expect(existsSync(join(backupsDir(), b.backup.name))).toBe(true);
		expect(existsSync(join(dir.path, 'tessera.db'))).toBe(true);
	});

	it('is a 404 the second time, and for a name that is not listed', async () => {
		const { backup } = await create();
		expect(handleDeleteBackup(app, backup.name, 'req').status).toBe(200);
		expect(handleDeleteBackup(app, backup.name, 'req').status).toBe(404);
		expect(handleDeleteBackup(app, 'never-was.db', 'req').status).toBe(404);
	});

	it.each(['../tessera.db', 'tessera.db', '..%2ftessera.db', 'sub/x.db', '', '..', 'notes.txt'])(
		'deletes nothing for the name %j',
		async (name) => {
			writeFileSync(join(backupsDir(), 'notes.txt'), 'keep me');
			const response = handleDeleteBackup(app, name, 'req');
			expect(response.status).toBe(404);
			expect(existsSync(join(dir.path, 'tessera.db'))).toBe(true);
			expect(readFileSync(join(backupsDir(), 'notes.txt'), 'utf8')).toBe('keep me');
			expect((await errorOf(response)).message).not.toContain(dir.path);
		}
	);

	it('logs the name of what it deleted', async () => {
		const { backup } = await create();
		handleDeleteBackup(app, backup.name, 'req');
		expect(logged.join('\n')).toContain('backup deleted');
	});
});

// ADR-021: Back up now keeps at most TESSERA_MAX_BACKUPS backups of kind manual, refuses the next with a 409 before it
// writes anything, and never deletes one itself. The copies Tessera makes before a delete, a restore, or an upgrade
// are never counted and never refused.
describe('the backup limit', () => {
	const limitTo = (maxBackups: number) => {
		app = { ...app, config: { ...app.config, maxBackups } };
	};
	const files = () => readdirSync(backupsDir()).sort();

	it('defaults to 10 and is reported with the list', async () => {
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.limit).toEqual({
			manualCount: 0,
			maxManual: 10,
			safetyCopies: 0,
			safetyCopiesBytes: 0
		});
	});

	it('takes backups up to the limit and refuses the next one with a 409 before writing anything', async () => {
		limitTo(3);
		for (let i = 0; i < 3; i += 1) {
			expect(handleCreateBackup(app, 'req').status).toBe(201);
			clock.advance(1000);
		}
		const before = files();
		const refused = handleCreateBackup(app, 'req');
		expect(refused.status).toBe(409);
		const error = await errorOf(refused);
		expect(error.code).toBe('backup_limit');
		expect(error.message).toMatch(/already 3 backups, the most Tessera keeps \(3\)/);
		expect(error.message).toMatch(/Delete one/);
		expect(error.message).not.toContain(dir.path);
		expect(files()).toEqual(before);
	});

	it('names the numbers so a script can act on them', async () => {
		limitTo(1);
		await create();
		const body = (await handleCreateBackup(app, 'req').json()) as {
			error: { details: { manualCount: number; maxManual: number } };
		};
		expect(body.error.details).toEqual({ manualCount: 1, maxManual: 1 });
	});

	it('deletes nothing by itself, and a place frees up when the person deletes one', async () => {
		limitTo(2);
		const first = await create();
		clock.advance(1000);
		const second = await create();
		clock.advance(1000);
		expect(handleCreateBackup(app, 'req').status).toBe(409);
		expect(files()).toEqual([first.backup.name, second.backup.name].sort());
		expect(handleDeleteBackup(app, first.backup.name, 'req').status).toBe(200);
		expect(handleCreateBackup(app, 'req').status).toBe(201);
		expect(handleCreateBackup(app, 'req').status).toBe(409);
	});

	it('does not count the safety copies, shows their number and size, and never refuses them', async () => {
		limitTo(1);
		writeFileSync(join(backupsDir(), 'pre-migrate-2026-10-01T00-00-00-000Z.db'), 'x'.repeat(100));
		writeFileSync(
			join(backupsDir(), 'pre-delete-kept-2026-10-02T00-00-00-000Z.db'),
			'x'.repeat(50)
		);
		writeFileSync(join(backupsDir(), 'pre-reset-kept-2026-10-03T00-00-00-000Z.db'), 'x'.repeat(25));
		writeFileSync(join(backupsDir(), 'pre-restore-2026-10-04T00-00-00-000Z.db'), 'x'.repeat(5));
		let body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.limit).toEqual({
			manualCount: 0,
			maxManual: 1,
			safetyCopies: 4,
			safetyCopiesBytes: 180
		});
		expect(handleCreateBackup(app, 'req').status).toBe(201);
		expect(handleCreateBackup(app, 'req').status).toBe(409);
		body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.limit).toMatchObject({ manualCount: 1, safetyCopies: 4, safetyCopiesBytes: 180 });
	});

	it('counts a copy the owner put in the folder under a manual- name, and no other file', async () => {
		limitTo(2);
		writeFileSync(join(backupsDir(), 'manual-before-update.db'), 'x');
		writeFileSync(join(backupsDir(), 'my-old-copy.db'), 'x');
		const body = (await handleListBackups(app).json()) as BackupsResponse;
		expect(body.limit).toMatchObject({ manualCount: 1, safetyCopies: 0 });
		expect(handleCreateBackup(app, 'req').status).toBe(201);
		expect(handleCreateBackup(app, 'req').status).toBe(409);
	});

	it('refuses at once when the folder already holds more than the limit', async () => {
		limitTo(2);
		for (const n of [1, 2, 3, 4]) writeFileSync(join(backupsDir(), `manual-before-${n}.db`), 'x');
		const refused = handleCreateBackup(app, 'req');
		expect(refused.status).toBe(409);
		expect((await errorOf(refused)).message).toMatch(
			/already 4 backups, the most Tessera keeps \(2\)/
		);
		expect(files()).toHaveLength(4);
	});

	it('leaves download and delete working at the limit, and logs the refusal without the data', async () => {
		limitTo(1);
		const { backup } = await create();
		expect(handleCreateBackup(app, 'req').status).toBe(409);
		expect(handleDownloadBackup(app, backup.name, 'req').status).toBe(200);
		expect(logged.join('\n')).toContain('backup refused, the limit is reached');
		expect(logged.join('\n')).not.toContain('Kept');
		expect(handleDeleteBackup(app, backup.name, 'req').status).toBe(200);
	});

	it('does not use up a place when writing fails', async () => {
		limitTo(1);
		// A database whose copy fails the way a full disk does.
		const failing = {
			...app,
			database: {
				...app.database,
				sqlite: {
					prepare: () => ({
						run: () => {
							throw new Error('database or disk is full');
						}
					})
				}
			}
		} as unknown as AppContext;
		expect(() => handleCreateBackup(failing, 'req')).toThrow('database or disk is full');
		expect(files()).toEqual([]);
		// The failed try took no place: the one allowed backup can still be made.
		expect(handleCreateBackup(app, 'req').status).toBe(201);
		expect(handleCreateBackup(app, 'req').status).toBe(409);
	});
});
