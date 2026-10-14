import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	BackupsResponse,
	RestorePreviewResponse,
	RestoreResponse
} from '#lib/core/api-types.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleCreateBackup, handleListBackups } from '#lib/server/api/backups.ts';
import { handlePreviewRestore, handleRestore } from '#lib/server/api/restore.ts';
import { PENDING_FILE } from '#lib/server/restore/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Restore over HTTP (US-15, ADR-014): look at what a backup holds beside what is there now, then ask for it with
// "restore" typed. The server only stages the restore and asks itself to stop; the next start applies it.

let dir: TempDir;
let app: AppContext;
let shutdowns = 0;
const logged: string[] = [];
const clock = fakeClock('2026-10-12T12:00:00.000Z');

beforeEach(() => {
	dir = makeTempDir();
	shutdowns = 0;
	logged.length = 0;
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) }),
		requestShutdown: () => {
			shutdowns++;
		}
	});
	seed('kept');
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

function seed(id: string) {
	importForSetup(app.db, makeDeck([basic(`${id}-1`), basic(`${id}-2`)], { id, title: id }), clock);
}

const backupName = async () => {
	const response = handleCreateBackup(app, 'req');
	clock.advance(1000);
	return ((await response.json()) as { backup: { name: string } }).backup.name;
};
const post = (body: unknown, raw = false) =>
	new Request('http://localhost/api/backups/x/restore', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (body as string) : JSON.stringify(body)
	});
const restore = (name: string, body: unknown = { confirm: 'restore' }, raw = false) =>
	handleRestore(app, name, post(body, raw), 'req');
const errorOf = async (response: Response) =>
	(
		(await response.json()) as {
			error: { code: string; message: string; details?: unknown };
		}
	).error;

describe('GET /api/backups/:name/preview', () => {
	it('shows what the backup holds beside what is there now', async () => {
		const name = await backupName();
		seed('later');
		const response = handlePreviewRestore(app, name, 'req');
		expect(response.status).toBe(200);
		const body = (await response.json()) as RestorePreviewResponse;
		expect(body.restorable).toBe(true);
		expect(body.backup.name).toBe(name);
		expect(body.summary).toMatchObject({ decks: 1, cards: 2, reviews: 0 });
		expect(body.current).toMatchObject({ decks: 2, cards: 4, reviews: 0 });
	});

	it('says why a file cannot be restored, and still shows what is there now', async () => {
		mkdirBackups();
		writeFileSync(join(dir.path, 'backups', 'junk.db'), 'not sqlite '.repeat(100));
		const body = (await handlePreviewRestore(
			app,
			'junk.db',
			'req'
		).json()) as RestorePreviewResponse;
		expect(body.restorable).toBe(false);
		expect(body.reason).toMatch(/not a SQLite database/);
		expect(body.summary).toBeUndefined();
		expect(body.current.decks).toBe(1);
	});

	it.each(['../tessera.db', 'tessera.db', 'nope.db', '', 'a/b.db', '..%2ftessera.db'])(
		'is a 404 for the name %j, and gives away nothing',
		async (name) => {
			const response = handlePreviewRestore(app, name, 'req');
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain(dir.path);
		}
	);
});

function mkdirBackups() {
	if (!existsSync(join(dir.path, 'backups'))) handleCreateBackup(app, 'req');
}

describe('POST /api/backups/:name/restore', () => {
	it('stages the restore, takes a copy of what is there now, asks the server to stop, and answers 202', async () => {
		const name = await backupName();
		seed('later');
		const response = await restore(name);
		expect(response.status).toBe(202);
		const body = (await response.json()) as RestoreResponse;
		expect(body.restoring.name).toBe(name);
		expect(body.restoring.safetyCopy).toMatch(/^pre-restore-.*\.db$/);
		expect(existsSync(join(dir.path, 'backups', body.restoring.safetyCopy))).toBe(true);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(true);
		expect(JSON.parse(readFileSync(join(dir.path, PENDING_FILE), 'utf8'))).toMatchObject({ name });
		expect(shutdowns).toBe(1);
	});

	it('changes no data yet: the live database is as it was until the restart', async () => {
		const name = await backupName();
		seed('later');
		await restore(name);
		const list = (await handleListBackups(app).json()) as BackupsResponse;
		expect(list.backups.length).toBeGreaterThan(1);
		expect(
			(app.database.sqlite.prepare('select count(*) as n from decks').get() as { n: number }).n
		).toBe(2);
	});

	it.each([
		['no confirmation', {}],
		['the wrong word', { confirm: 'yes' }],
		['the word in capitals', { confirm: 'RESTORE' }],
		['a confirmation that is not text', { confirm: true }],
		['a field it does not know', { confirm: 'restore', force: true }]
	])('refuses %s with a 422, and does nothing', async (_label, body) => {
		const name = await backupName();
		const response = await restore(name, body);
		expect(response.status).toBe(422);
		expect((await errorOf(response)).details).toMatchObject({ errors: [{}] });
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		expect(shutdowns).toBe(0);
		expect(readdirSync(join(dir.path, 'backups')).some((n) => n.startsWith('pre-restore-'))).toBe(
			false
		);
	});

	it.each([
		['no body', ''],
		['text that is not JSON', 'nope'],
		['a JSON array', '[]']
	])('refuses %s', async (_label, raw) => {
		const name = await backupName();
		const response = await restore(name, raw, true);
		expect([400, 422]).toContain(response.status);
		expect(shutdowns).toBe(0);
	});

	it.each(['../tessera.db', 'tessera.db', 'nope.db', '', 'a/b.db'])(
		'is a 404 for the name %j, and does nothing',
		async (name) => {
			const response = await restore(name);
			expect(response.status).toBe(404);
			expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
			expect(shutdowns).toBe(0);
		}
	);

	it('refuses a backup that cannot be restored, with the reason, and does nothing', async () => {
		mkdirBackups();
		writeFileSync(join(dir.path, 'backups', 'junk.db'), 'not sqlite '.repeat(100));
		const response = await restore('junk.db');
		expect(response.status).toBe(422);
		expect((await errorOf(response)).message).toMatch(/not a SQLite database/);
		expect(readdirSync(join(dir.path, 'backups')).some((n) => n.startsWith('pre-restore-'))).toBe(
			false
		);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		expect(shutdowns).toBe(0);
	});

	it('refuses a second restore while one is waiting for the restart (409)', async () => {
		const name = await backupName();
		expect((await restore(name)).status).toBe(202);
		const second = await restore(name);
		expect(second.status).toBe(409);
		expect(shutdowns).toBe(1);
	});

	it('refuses a body over the small limit', async () => {
		const name = await backupName();
		const response = await restore(name, { confirm: 'x'.repeat(20_000) });
		expect(response.status).toBe(413);
	});

	it('logs the name of the backup and of the safety copy', async () => {
		const name = await backupName();
		await restore(name);
		const lines = logged.join('\n');
		expect(lines).toContain('restore staged');
		expect(lines).toContain(name);
	});
});

describe('GET /api/backups after a restore', () => {
	it('tells the page what the last restart did', async () => {
		writeFileSync(
			join(dir.path, 'restore-result.json'),
			JSON.stringify({
				ok: true,
				name: 'manual-x.db',
				at: '2026-10-12T12:30:00.000Z',
				message: 'Restored.'
			})
		);
		const list = (await handleListBackups(app).json()) as BackupsResponse;
		expect(list.lastRestore).toMatchObject({ ok: true, name: 'manual-x.db' });
	});

	it('says nothing when there was none', async () => {
		const list = (await handleListBackups(app).json()) as BackupsResponse;
		expect(list.lastRestore).toBeUndefined();
	});

	it('also reports a restore that is waiting for the restart', async () => {
		const name = await backupName();
		await restore(name);
		const list = (await handleListBackups(app).json()) as BackupsResponse;
		expect(list.pendingRestore).toBe(name);
	});
});
