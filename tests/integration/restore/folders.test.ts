import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { createSnapshot } from '#lib/server/backups/index.ts';
import { assignDecks, createFolder } from '#lib/server/folders/index.ts';
import { applyPendingRestore, inspectBackup, stageRestore } from '#lib/server/restore/index.ts';
import { listDecks, listFolders } from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// Folders live in the database, so a snapshot takes them along and a restore brings them back as they were. A
// backup made before folders existed restores too, and is upgraded the usual way when the database is opened.

let dir: TempDir;
let clock: FakeClock;
let handle: DatabaseHandle;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock('2026-10-15T12:00:00.000Z');
	handle = openDatabase({ dataDir: dir.path, clock });
});

afterEach(() => {
	if (handle.sqlite.open) handle.close();
	dir.cleanup();
});

function seedDeck(id: string) {
	importForSetup(handle.db, makeDeck([basic(`${id}-1`)], { id, title: id }), clock);
}

function folder(name: string): number {
	const made = createFolder(handle.db, name, clock.now().toISOString());
	if (!made.ok) throw new Error('folder failed');
	return made.value.id;
}

function shape(db: DatabaseHandle['db']) {
	return {
		folders: listFolders(db).map((f) => f.name),
		decks: listDecks(db).map((d) => [d.id, d.folderId])
	};
}

describe('backups and folders', () => {
	it('puts the folders and which decks are in them into a snapshot, and brings them back on restore', () => {
		seedDeck('d1');
		seedDeck('d2');
		const course = folder('Course');
		assignDecks(handle.db, ['d1'], course);
		const snapshot = createSnapshot(handle.sqlite, dir.path, 'manual', clock);

		// Changes after the backup: a second folder, d2 moved in, d1 moved out.
		const other = folder('Other');
		assignDecks(handle.db, ['d2'], other);
		assignDecks(handle.db, ['d1'], null);
		expect(shape(handle.db).folders).toEqual(['Course', 'Other']);
		handle.close();

		expect(stageRestore(dir.path, snapshot.name, clock).ok).toBe(true);
		expect(applyPendingRestore(dir.path, clock)).toMatchObject({ ok: true });

		const reopened = openDatabase({ dataDir: dir.path, clock });
		try {
			expect(shape(reopened.db)).toEqual({
				folders: ['Course'],
				decks: [
					['d1', course],
					['d2', null]
				]
			});
			// A folder made after the restore does not reuse the number of one that is gone.
			const made = createFolder(reopened.db, 'After', clock.now().toISOString());
			expect(made.ok && made.value.id).toBeGreaterThan(course);
		} finally {
			reopened.close();
		}
	});

	it('restores a backup made before folders existed, and upgrades it when it is opened', () => {
		// A database from the release before folders: the first two migrations only.
		const old = join(dir.path, 'older-migrations');
		cpSync('drizzle', old, { recursive: true });
		const journalPath = join(old, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
		journal.entries = journal.entries.slice(0, 2);
		writeFileSync(journalPath, JSON.stringify(journal, null, 2));

		handle.close();
		const oldDir = join(dir.path, 'old-data');
		const before = openDatabase({ dataDir: oldDir, clock, migrationsFolder: old });
		before.sqlite
			.prepare('insert into decks (id, title, created_at, updated_at) values (?, ?, ?, ?)')
			.run('ccna-01', 'CCNA 01', clock.now().toISOString(), clock.now().toISOString());
		const snapshot = createSnapshot(before.sqlite, oldDir, 'manual', clock);
		before.close();

		// The old snapshot goes into the current data folder's backups, as if it had always been there.
		const backupsFolder = join(dir.path, 'backups');
		cpSync(join(oldDir, 'backups', snapshot.name), join(backupsFolder, snapshot.name));
		const inspected = inspectBackup(dir.path, snapshot.name);
		expect(inspected.ok && inspected.value.summary.decks).toBe(1);

		expect(stageRestore(dir.path, snapshot.name, clock).ok).toBe(true);
		expect(applyPendingRestore(dir.path, clock)).toMatchObject({ ok: true });

		const reopened = openDatabase({ dataDir: dir.path, clock });
		try {
			expect(reopened.migration.pending).toBe(1);
			expect(shape(reopened.db)).toEqual({ folders: [], decks: [['ccna-01', null]] });
			const table = reopened.sqlite
				.prepare("select name from sqlite_master where name = 'folders'")
				.get();
			expect(table).toBeDefined();
		} finally {
			reopened.close();
		}
	});

	it('has the folders table in a snapshot, for anyone reading a backup by hand', () => {
		const course = folder('Course');
		const snapshot = createSnapshot(handle.sqlite, dir.path, 'manual', clock);
		const copy = new Database(join(dir.path, 'backups', snapshot.name), { readonly: true });
		try {
			expect(copy.prepare('select id, name from folders').all()).toEqual([
				{ id: course, name: 'Course' }
			]);
		} finally {
			copy.close();
		}
	});
});
