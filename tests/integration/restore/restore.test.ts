import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { createSnapshot } from '#lib/server/backups/index.ts';
import {
	PENDING_FILE,
	RESULT_FILE,
	applyPendingRestore,
	inspectBackup,
	readLastRestore,
	stageRestore,
	summarizeDatabase,
	type ApplyStep
} from '#lib/server/restore/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Restore from the Backups list (US-15, ADR-014). The server never swaps a database it has open: it stages the
// choice in a marker file and stops, and the next start applies it before the database is opened. These tests cover
// the inspection of a backup, the apply, and a crash at every step of the apply.

let dir: TempDir;
let clock: FakeClock;
let handle: DatabaseHandle;
const NOW = '2026-10-12T12:00:00.000Z';

function seed(id: string, cards = 2) {
	importForSetup(
		handle.db,
		makeDeck(
			Array.from({ length: cards }, (_, i) => basic(`${id}-${i}`)),
			{ id, title: id }
		),
		clock
	);
}

const decksIn = (path: string): string[] => {
	const db = new Database(path, { readonly: true });
	try {
		return (db.prepare('select id from decks order by id').all() as { id: string }[]).map(
			(row) => row.id
		);
	} finally {
		db.close();
	}
};
const live = () => join(dir.path, 'tessera.db');
const backups = () => join(dir.path, 'backups');
const names = () => readdirSync(dir.path).sort();

// Data folder with deck "kept" in a backup and deck "later" added afterwards. The server is then stopped, which is
// what the real shutdown does before the restart that applies the restore.
function setUp(): { backupName: string } {
	seed('kept');
	const snapshot = createSnapshot(handle.sqlite, dir.path, 'manual', clock);
	clock.advance(60_000);
	seed('later');
	handle.close();
	return { backupName: snapshot.name };
}

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(NOW);
	handle = openDatabase({ dataDir: dir.path, clock });
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

describe('summarizeDatabase and inspectBackup', () => {
	it('counts what a database holds', () => {
		seed('a', 3);
		seed('b', 1);
		handle.close();
		const summary = summarizeDatabase(live());
		expect(summary.ok && summary.value).toMatchObject({ decks: 2, cards: 4, reviews: 0 });
	});

	it('accepts a real backup, and says what is in it', () => {
		const { backupName } = setUp();
		const result = inspectBackup(dir.path, backupName);
		expect(result.ok && result.value.summary).toMatchObject({ decks: 1, cards: 2 });
	});

	it('refuses a file that is not a database', () => {
		setUp();
		mkdirSync(backups(), { recursive: true });
		writeFileSync(join(backups(), 'junk.db'), 'this is not sqlite at all, just text '.repeat(50));
		const result = inspectBackup(dir.path, 'junk.db');
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.kind).toBe('not_a_database');
	});

	it('refuses a database that is not a Tessera database', () => {
		setUp();
		const other = new Database(join(backups(), 'other.db'));
		other.exec('create table t (x integer); insert into t values (1);');
		other.close();
		const result = inspectBackup(dir.path, 'other.db');
		expect(!result.ok && result.error.kind).toBe('not_tessera');
	});

	it('refuses a damaged database', () => {
		const { backupName } = setUp();
		const path = join(backups(), backupName);
		const bytes = readFileSync(path);
		// Overwrite the middle of the file: the header survives, the pages do not.
		for (let i = 8192; i < Math.min(bytes.length, 20_000); i++) bytes[i] = 0xff;
		writeFileSync(path, bytes);
		const result = inspectBackup(dir.path, backupName);
		expect(result.ok).toBe(false);
	});

	it('refuses a database written by a newer version than this one understands', () => {
		const { backupName } = setUp();
		const db = new Database(join(backups(), backupName));
		db.prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)').run(
			'future',
			Date.now() + 10 * 365 * 86_400_000
		);
		db.close();
		const result = inspectBackup(dir.path, backupName);
		expect(!result.ok && result.error.kind).toBe('too_new');
		expect(!result.ok && result.error.message).toMatch(/newer version/);
	});

	it('accepts a database from an older version, which is upgraded when it is opened', () => {
		const { backupName } = setUp();
		const db = new Database(join(backups(), backupName));
		db.exec(
			'drop table deck_resets; delete from __drizzle_migrations where id = (select max(id) from __drizzle_migrations);'
		);
		db.close();
		expect(inspectBackup(dir.path, backupName).ok).toBe(true);
	});

	it('never opens a name that is not a listed backup', () => {
		setUp();
		for (const name of ['../tessera.db', 'tessera.db', 'nope.db', '', 'a/b.db']) {
			const result = inspectBackup(dir.path, name);
			expect(!result.ok && result.error.kind, name).toBe('not_found');
		}
	});
});

describe('stageRestore and applyPendingRestore', () => {
	it('does nothing when no restore is staged, and leaves the database alone', () => {
		seed('kept');
		handle.close();
		const before = readFileSync(live());
		expect(applyPendingRestore(dir.path, clock)).toBeUndefined();
		expect(readFileSync(live()).equals(before)).toBe(true);
	});

	it('puts the backup in place, keeps the old database aside, and leaves no marker', () => {
		const { backupName } = setUp();
		expect(stageRestore(dir.path, backupName, clock).ok).toBe(true);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(true);
		// Staging changes nothing yet.
		expect(decksIn(live())).toEqual(['kept', 'later']);

		const result = applyPendingRestore(dir.path, clock);
		expect(result).toMatchObject({ ok: true, name: backupName });
		expect(decksIn(live())).toEqual(['kept']);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		const aside = names().filter((n) => n.startsWith('tessera.db.before-restore-'));
		expect(aside).toHaveLength(1);
		expect(decksIn(join(dir.path, aside[0]!))).toEqual(['kept', 'later']);
		// The backup itself is untouched and can be used again.
		expect(decksIn(join(backups(), backupName))).toEqual(['kept']);
	});

	it('removes the old write-ahead files, which would corrupt the restored database', () => {
		const { backupName } = setUp();
		writeFileSync(`${live()}-wal`, 'stale wal');
		writeFileSync(`${live()}-shm`, 'stale shm');
		stageRestore(dir.path, backupName, clock);
		applyPendingRestore(dir.path, clock);
		expect(existsSync(`${live()}-wal`)).toBe(false);
		expect(existsSync(`${live()}-shm`)).toBe(false);
		expect(decksIn(live())).toEqual(['kept']);
	});

	it('records the result, for the page to show', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		applyPendingRestore(dir.path, clock);
		expect(readLastRestore(dir.path)).toMatchObject({ ok: true, name: backupName });
		expect(existsSync(join(dir.path, RESULT_FILE))).toBe(true);
	});

	it('opens normally afterwards, and migrates an older backup the usual way', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		applyPendingRestore(dir.path, clock);
		const reopened = openDatabase({ dataDir: dir.path, clock });
		try {
			expect(reopened.migration.pending).toBe(0);
			expect(
				(reopened.sqlite.prepare('select count(*) as n from decks').get() as { n: number }).n
			).toBe(1);
		} finally {
			reopened.close();
		}
	});

	it('refuses to stage a backup that is not restorable, and stages nothing', () => {
		setUp();
		writeFileSync(join(backups(), 'junk.db'), 'not sqlite '.repeat(100));
		const result = stageRestore(dir.path, 'junk.db', clock);
		expect(result.ok).toBe(false);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
	});

	it('will not stage a second restore while one is waiting', () => {
		const { backupName } = setUp();
		expect(stageRestore(dir.path, backupName, clock).ok).toBe(true);
		const second = stageRestore(dir.path, backupName, clock);
		expect(!second.ok && second.error.kind).toBe('already_pending');
	});

	it('leaves the database alone and says why if the backup has gone or turned bad by the time of the restart', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		rmSync(join(backups(), backupName));
		const before = readFileSync(live());
		const result = applyPendingRestore(dir.path, clock);
		expect(result).toMatchObject({ ok: false });
		expect(readFileSync(live()).equals(before)).toBe(true);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		expect(readLastRestore(dir.path)).toMatchObject({ ok: false });
		expect(names().some((n) => n.includes('.restoring'))).toBe(false);
	});

	it.each([
		[
			'a name that climbs out of the folder',
			{ name: '../tessera.db', oldName: 'tessera.db.before-restore-x' }
		],
		[
			'the live database as the backup',
			{ name: 'tessera.db', oldName: 'tessera.db.before-restore-x' }
		],
		['an old-database name that is a path', { name: 'KEEP', oldName: '../elsewhere' }],
		['an old-database name that is the live database', { name: 'KEEP', oldName: 'tessera.db' }],
		['a marker that is not JSON', 'nope']
	])('refuses a marker with %s, and moves nothing', (_label, marker) => {
		const { backupName } = setUp();
		const fixed =
			typeof marker === 'string'
				? marker
				: JSON.stringify({ ...marker, name: marker.name === 'KEEP' ? backupName : marker.name });
		writeFileSync(join(dir.path, PENDING_FILE), fixed);
		const before = readFileSync(live());
		const result = applyPendingRestore(dir.path, clock);
		expect(result).toMatchObject({ ok: false });
		expect(readFileSync(live()).equals(before)).toBe(true);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		expect(names().filter((n) => n.startsWith('tessera.db.before'))).toEqual([]);
	});
});

describe('a crash at any step of the apply', () => {
	const STEPS: ApplyStep[] = ['copied', 'moved-aside', 'installed', 'cleaned'];

	it.each(STEPS)(
		'after "%s": the next start finishes the restore, and the end state is the same',
		(step) => {
			const { backupName } = setUp();
			stageRestore(dir.path, backupName, clock);
			expect(() =>
				applyPendingRestore(dir.path, clock, {
					after: (reached) => {
						if (reached === step) throw new Error(`simulated crash after ${step}`);
					}
				})
			).toThrow(/simulated crash/);

			const result = applyPendingRestore(dir.path, clock);
			expect(result).toMatchObject({ ok: true });
			expect(decksIn(live())).toEqual(['kept']);
			expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
			expect(names().some((n) => n.includes('.restoring'))).toBe(false);
			const aside = names().filter((n) => n.startsWith('tessera.db.before-restore-'));
			expect(aside).toHaveLength(1);
			expect(decksIn(join(dir.path, aside[0]!))).toEqual(['kept', 'later']);
			expect(existsSync(`${live()}-wal`)).toBe(false);
		}
	);

	it('never leaves the two databases mixed: after any crash the live file is either the old database or the whole backup, or missing', () => {
		for (const step of STEPS) {
			if (handle.sqlite.open) handle.close();
			dir.cleanup();
			dir = makeTempDir();
			handle = openDatabase({ dataDir: dir.path, clock });
			const { backupName } = setUp();
			stageRestore(dir.path, backupName, clock);
			try {
				applyPendingRestore(dir.path, clock, {
					after: (reached) => {
						if (reached === step) throw new Error('crash');
					}
				});
			} catch {
				// expected
			}
			if (existsSync(live())) {
				const decks = decksIn(live());
				expect([['kept'], ['kept', 'later']], step).toContainEqual(decks);
			}
		}
	});

	it('puts the old database back if, after it was moved aside, the restore turns out to be impossible', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		expect(() =>
			applyPendingRestore(dir.path, clock, {
				after: (reached) => {
					if (reached === 'moved-aside') throw new Error('crash');
				}
			})
		).toThrow('crash');
		// Now the live file is missing, the copy and the backup are gone, and only the old database remains.
		expect(existsSync(live())).toBe(false);
		rmSync(`${live()}.restoring`);
		rmSync(join(backups(), backupName));

		const result = applyPendingRestore(dir.path, clock);
		expect(result).toMatchObject({ ok: false });
		expect(decksIn(live())).toEqual(['kept', 'later']);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
	});

	it('removes a stray copy when the restore is already in place', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		expect(() =>
			applyPendingRestore(dir.path, clock, {
				after: (reached) => {
					if (reached === 'cleaned') throw new Error('crash');
				}
			})
		).toThrow('crash');
		writeFileSync(`${live()}.restoring`, 'left over');
		expect(applyPendingRestore(dir.path, clock)).toMatchObject({ ok: true });
		expect(existsSync(`${live()}.restoring`)).toBe(false);
		expect(decksIn(live())).toEqual(['kept']);
	});

	it('names the old database so that it never collides with one kept by an earlier restore at the same moment', () => {
		const { backupName } = setUp();
		const stamp = NOW.replace(/[:.]/g, '-');
		writeFileSync(join(dir.path, `tessera.db.before-restore-${stamp}`), 'earlier');
		clock.set(NOW);
		const staged = stageRestore(dir.path, backupName, clock);
		expect(staged.ok && staged.value.oldName).toBe(`tessera.db.before-restore-${stamp}-1`);
	});

	it('copes with a half-written copy left by a crash during the copy', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		writeFileSync(`${live()}.restoring`, 'half of a database');
		const result = applyPendingRestore(dir.path, clock);
		expect(result).toMatchObject({ ok: true });
		expect(decksIn(live())).toEqual(['kept']);
	});

	it('copes with a data folder that has no database at all', () => {
		const { backupName } = setUp();
		rmSync(live());
		stageRestore(dir.path, backupName, clock);
		expect(applyPendingRestore(dir.path, clock)).toMatchObject({ ok: true });
		expect(decksIn(live())).toEqual(['kept']);
	});

	it('does a second restore later with its own name for the old database, so nothing is overwritten', () => {
		const { backupName } = setUp();
		stageRestore(dir.path, backupName, clock);
		applyPendingRestore(dir.path, clock);
		clock.advance(1000);
		stageRestore(dir.path, backupName, clock);
		applyPendingRestore(dir.path, clock);
		expect(names().filter((n) => n.startsWith('tessera.db.before-restore-'))).toHaveLength(2);
	});
});
