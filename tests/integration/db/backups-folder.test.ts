import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseOpenError, openDatabase } from '#lib/server/db/index.ts';
import type { DatabaseHandle } from '#lib/server/db/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// A fresh install has never made an upgrade backup, so the folder that the operations guide puts manual
// backups in must exist anyway. Found on the first real deploy (backlog item B-1): the documented backup
// command failed with SQLITE_CANTOPEN because /data/backups did not exist.

let dir: TempDir;
const handles: DatabaseHandle[] = [];

function open(): DatabaseHandle {
	const handle = openDatabase({ dataDir: dir.path, clock: fakeClock('2026-10-11T12:00:00.000Z') });
	handles.push(handle);
	return handle;
}

beforeEach(() => {
	dir = makeTempDir();
});

afterEach(() => {
	for (const handle of handles.splice(0)) handle.close();
	dir.cleanup();
});

// The two commands as printed in docs/operations.md. The script between the quotes is run as it is written
// there, so the test fails if the guide and the application drift apart.
const guide = readFileSync('docs/operations.md', 'utf8');
const backupBlock = /<!-- backup-command -->\s*```bash\n([\s\S]*?)```/.exec(guide)?.[1] ?? '';
const backupScript = /node -e "([\s\S]*?)" \/data\/tessera\.db (\S+)/.exec(backupBlock);
const checkBlock =
	/```bash\n(docker compose exec tessera node -e "[^"]*integrity_check[^"]*" \S+)\n```/.exec(
		guide
	)?.[1];
const checkScript = /node -e "([\s\S]*?)" \/data\/backups\//.exec(checkBlock ?? '')?.[1];

function run(script: string, ...args: string[]) {
	return spawnSync(process.execPath, ['-e', script, ...args], { encoding: 'utf8' });
}

describe('the backups folder on a fresh install', () => {
	it('exists after the database is opened for the first time', () => {
		open();
		expect(existsSync(join(dir.path, 'backups'))).toBe(true);
		expect(statSync(join(dir.path, 'backups')).isDirectory()).toBe(true);
	});

	it('is created even when the data folder itself did not exist yet', () => {
		const nested = join(dir.path, 'a', 'b');
		const handle = openDatabase({ dataDir: nested, clock: fakeClock('2026-10-11T12:00:00.000Z') });
		handles.push(handle);
		expect(statSync(join(nested, 'backups')).isDirectory()).toBe(true);
	});

	it('leaves backups that are already there alone', () => {
		mkdirSync(join(dir.path, 'backups'));
		writeFileSync(join(dir.path, 'backups', 'pre-migrate-old.db'), 'keep me');
		open();
		expect(readdirSync(join(dir.path, 'backups'))).toEqual(['pre-migrate-old.db']);
		expect(readFileSync(join(dir.path, 'backups', 'pre-migrate-old.db'), 'utf8')).toBe('keep me');
	});

	it('refuses to start, saying why, when backups exists as a file', () => {
		writeFileSync(join(dir.path, 'backups'), 'not a folder');
		let error: unknown;
		try {
			open();
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(DatabaseOpenError);
		expect((error as Error).message).toContain(join(dir.path, 'backups'));
		expect((error as Error).message).toMatch(/not a folder|is a file/i);
	});
});

describe('the backup commands in docs/operations.md, on a fresh install', () => {
	it('were found in the guide', () => {
		expect(backupScript?.[1], 'backup script').toContain('VACUUM INTO');
		expect(backupScript?.[2], 'backup destination').toContain('/data/backups/');
		expect(checkScript, 'integrity check script').toContain('integrity_check');
	});

	it('take a backup into /data/backups and find it sound, with nothing prepared by hand', () => {
		const handle = open();
		handle.sqlite.exec(
			"insert into decks (id, title, created_at, updated_at) values ('d', 'D', 'x', 'x')"
		);

		const destination = join(dir.path, 'backups', 'manual-test.db');
		const backup = run(backupScript![1]!, join(dir.path, 'tessera.db'), destination);
		expect(backup.stderr).toBe('');
		expect(backup.status).toBe(0);
		expect(existsSync(destination)).toBe(true);

		const check = run(checkScript!, destination);
		expect(check.stderr).toBe('');
		expect(check.stdout.trim()).toBe('ok');
	});
});
