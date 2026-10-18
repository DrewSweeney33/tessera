import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '#lib/core/settings.ts';
import {
	DatabaseOpenError,
	DatabaseTooNewError,
	backupTo,
	openDatabase,
	withTx,
	schema
} from '#lib/server/db/index.ts';
import type { DatabaseHandle } from '#lib/server/db/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;
const handles: DatabaseHandle[] = [];

function open(dataDir = dir.path, migrationsFolder?: string): DatabaseHandle {
	const handle = openDatabase({
		dataDir,
		clock: fakeClock('2026-10-10T12:00:00.000Z'),
		...(migrationsFolder ? { migrationsFolder } : {})
	});
	handles.push(handle);
	return handle;
}

function names(handle: DatabaseHandle, type: 'table' | 'index'): string[] {
	return (
		handle.sqlite
			.prepare("select name from sqlite_master where type = ? and name not like 'sqlite_%'")
			.all(type) as { name: string }[]
	)
		.map((row) => row.name)
		.sort();
}

function pragma(handle: DatabaseHandle, name: string): unknown {
	return handle.sqlite.pragma(name, { simple: true });
}

const now = '2026-10-10T12:00:00.000Z';

function insertDeck(handle: DatabaseHandle, id = 'd1') {
	handle.db
		.insert(schema.decks)
		.values({ id, title: 'Deck', createdAt: now, updatedAt: now })
		.run();
}

// A deck written with plain SQL, for a database made by an older migration than the current schema.
function insertDeckRaw(handle: DatabaseHandle, id: string) {
	handle.sqlite
		.prepare('insert into decks (id, title, created_at, updated_at) values (?, ?, ?, ?)')
		.run(id, 'Deck', now, now);
}

function insertCard(handle: DatabaseHandle, deckId = 'd1', key = 'c1') {
	return handle.db
		.insert(schema.cards)
		.values({
			deckId,
			key,
			type: 'basic',
			content: { front: 'Q', back: 'A' },
			contentHash: 'hash',
			position: 0,
			createdAt: now,
			updatedAt: now
		})
		.returning({ pk: schema.cards.pk })
		.get().pk;
}

beforeEach(() => {
	dir = makeTempDir();
});

afterEach(() => {
	for (const handle of handles.splice(0)) {
		if (handle.sqlite.open) handle.close();
	}
	dir.cleanup();
});

describe('openDatabase on a fresh directory', () => {
	it('creates the database file, tables, and indexes', () => {
		const handle = open(join(dir.path, 'nested', 'data'));
		expect(existsSync(join(dir.path, 'nested', 'data', 'tessera.db'))).toBe(true);
		expect(names(handle, 'table')).toEqual(
			[
				'__drizzle_migrations',
				'card_state',
				'cards',
				'deck_resets',
				'decks',
				'folders',
				'import_history',
				'review_log',
				'settings'
			].sort()
		);
		expect(names(handle, 'index')).toEqual(
			expect.arrayContaining([
				'card_state_due_idx',
				'card_state_phase_idx',
				'cards_deck_key_unique',
				'cards_deck_position_idx',
				'review_log_card_idx',
				'review_log_mode_time_idx',
				'review_log_time_idx'
			])
		);
	});

	it('applies the documented pragmas', () => {
		const handle = open();
		expect(pragma(handle, 'journal_mode')).toBe('wal');
		expect(pragma(handle, 'foreign_keys')).toBe(1);
		expect(pragma(handle, 'busy_timeout')).toBe(5000);
		expect(pragma(handle, 'synchronous')).toBe(1); // NORMAL
	});

	it('seeds default settings as JSON values', () => {
		const handle = open();
		const rows = handle.db.select().from(schema.settings).all();
		const values = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
		expect(values).toEqual(DEFAULT_SETTINGS);
	});

	it('reports every migration as pending on a new database and writes no backup', () => {
		const handle = open();
		expect(handle.migration).toEqual({ pending: 4, backupPath: undefined });
		expect(readdirSync(join(dir.path, 'backups'))).toEqual([]);
	});
});

describe('reopening an existing database', () => {
	it('applies nothing, keeps user-changed settings, and writes no backup', () => {
		const first = open();
		first.sqlite.prepare("update settings set value = '0.85' where key = 'targetRetention'").run();
		first.close();

		const second = open();
		expect(second.migration).toEqual({ pending: 0, backupPath: undefined });
		const row = second.sqlite
			.prepare("select value from settings where key = 'targetRetention'")
			.get() as { value: string };
		expect(row.value).toBe('0.85');
		expect(readdirSync(join(dir.path, 'backups'))).toEqual([]);
	});
});

describe('upgrading an existing database', () => {
	function forgeNewerMigrations(extraSql: string): string {
		const folder = join(dir.path, 'migrations');
		cpSync('drizzle', folder, { recursive: true });
		const journalPath = join(folder, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
			entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
		};
		const last = journal.entries[journal.entries.length - 1]!;
		journal.entries.push({
			idx: last.idx + 1,
			version: last.version,
			when: last.when + 60_000,
			tag: '0001_test_upgrade',
			breakpoints: true
		});
		writeFileSync(journalPath, JSON.stringify(journal, null, 2));
		writeFileSync(join(folder, '0001_test_upgrade.sql'), extraSql);
		return folder;
	}

	it('backs up the old database first, then applies the new migration', () => {
		const data = join(dir.path, 'data');
		const before = open(data);
		insertDeck(before);
		before.close();

		const folder = forgeNewerMigrations('ALTER TABLE `settings` ADD `note` text;');
		const after = open(data, folder);

		expect(after.migration.pending).toBe(1);
		const backupPath = after.migration.backupPath!;
		expect(backupPath).toContain(join('data', 'backups', 'pre-migrate-'));
		expect(readdirSync(join(data, 'backups'))).toHaveLength(1);

		const columns = (handle: Database.Database) =>
			(handle.prepare('pragma table_info(settings)').all() as { name: string }[]).map(
				(c) => c.name
			);
		expect(columns(after.sqlite)).toContain('note');

		const backup = new Database(backupPath, { readonly: true });
		try {
			expect(columns(backup)).not.toContain('note');
			expect((backup.prepare('select count(*) as n from decks').get() as { n: number }).n).toBe(1);
		} finally {
			backup.close();
		}
	});

	// The upgrade 0.1.1 users make: a database made by the first migration alone, then the real current folder.
	it('upgrades a database from the first release with the real migrations, backs it up first, and keeps its data', () => {
		const old = join(dir.path, 'first-release');
		cpSync('drizzle', old, { recursive: true });
		const journalPath = join(old, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
		journal.entries = journal.entries.slice(0, 1);
		writeFileSync(journalPath, JSON.stringify(journal, null, 2));

		const data = join(dir.path, 'data');
		const before = open(data, old);
		expect(names(before, 'table')).not.toContain('deck_resets');
		insertDeckRaw(before, 'kept');
		before.close();

		const after = open(data);
		expect(after.migration.pending).toBe(3);
		expect(names(after, 'table')).toContain('deck_resets');
		expect(names(after, 'table')).toContain('folders');
		expect(
			(after.sqlite.prepare("select id from decks where id = 'kept'").get() as { id: string }).id
		).toBe('kept');
		const backups = readdirSync(join(data, 'backups'));
		expect(backups).toHaveLength(1);
		const backup = new Database(join(data, 'backups', backups[0]!), { readonly: true });
		try {
			expect(
				(
					backup
						.prepare("select count(*) as n from sqlite_master where name = 'deck_resets'")
						.get() as { n: number }
				).n
			).toBe(0);
			expect(
				(backup.prepare("select count(*) as n from decks where id = 'kept'").get() as { n: number })
					.n
			).toBe(1);
		} finally {
			backup.close();
		}
		after.close();
	});

	// The upgrade that adds project folders: a database made by the first two migrations, with decks, cards, and
	// reviews in it, then the real current folder. Nothing may be lost and every deck starts ungrouped.
	it('adds folders to a database from 0001 and keeps every deck, card, and review', () => {
		const old = join(dir.path, 'before-folders');
		cpSync('drizzle', old, { recursive: true });
		const journalPath = join(old, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
		journal.entries = journal.entries.slice(0, 2);
		writeFileSync(journalPath, JSON.stringify(journal, null, 2));

		const data = join(dir.path, 'data');
		const before = open(data, old);
		expect(names(before, 'table')).not.toContain('folders');
		insertDeckRaw(before, 'ccna-01');
		insertDeckRaw(before, 'ccna-02');
		before.sqlite
			.prepare(
				"insert into cards (deck_id, key, type, content, content_hash, position, created_at, updated_at) values ('ccna-01', 'c1', 'basic', '{}', 'h', 0, ?, ?)"
			)
			.run(now, now);
		before.close();

		const after = open(data);
		expect(after.migration.pending).toBe(2);
		expect(names(after, 'table')).toContain('folders');
		const decks = after.sqlite.prepare('select id, folder_id from decks order by id').all() as {
			id: string;
			folder_id: number | null;
		}[];
		expect(decks).toEqual([
			{ id: 'ccna-01', folder_id: null },
			{ id: 'ccna-02', folder_id: null }
		]);
		expect((after.sqlite.prepare('select count(*) as n from cards').get() as { n: number }).n).toBe(
			1
		);
		const backups = readdirSync(join(data, 'backups'));
		expect(backups).toHaveLength(1);
		after.close();
	});

	// The upgrade that adds a folder's exam date (0003): a database made by the first three migrations, with folders
	// and grouped decks in it. Nothing may be lost, the folders get no exam date, and the old database is backed up.
	it('adds the exam date to a database from 0002 and keeps its folders and grouped decks', () => {
		const old = join(dir.path, 'before-exam-date');
		cpSync('drizzle', old, { recursive: true });
		const journalPath = join(old, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
		journal.entries = journal.entries.slice(0, 3);
		writeFileSync(journalPath, JSON.stringify(journal, null, 2));

		const data = join(dir.path, 'data');
		const before = open(data, old);
		expect(
			(before.sqlite.prepare('pragma table_info(folders)').all() as { name: string }[]).map(
				(column) => column.name
			)
		).not.toContain('exam_date');
		insertDeckRaw(before, 'ccna-01');
		before.sqlite
			.prepare("insert into folders (name, created_at, updated_at) values ('CCNA', ?, ?)")
			.run(now, now);
		before.sqlite.prepare("update decks set folder_id = 1 where id = 'ccna-01'").run();
		before.close();

		const after = open(data);
		expect(after.migration.pending).toBe(1);
		expect(after.sqlite.prepare('select id, name, exam_date from folders').all()).toEqual([
			{ id: 1, name: 'CCNA', exam_date: null }
		]);
		expect(after.sqlite.prepare("select folder_id from decks where id = 'ccna-01'").get()).toEqual({
			folder_id: 1
		});
		const backups = readdirSync(join(data, 'backups'));
		expect(backups).toHaveLength(1);
		const backup = new Database(join(data, 'backups', backups[0]!), { readonly: true });
		try {
			expect(
				(backup.prepare('pragma table_info(folders)').all() as { name: string }[]).map(
					(column) => column.name
				)
			).not.toContain('exam_date');
			expect((backup.prepare('select count(*) as n from folders').get() as { n: number }).n).toBe(
				1
			);
		} finally {
			backup.close();
		}
		after.close();
	});

	it('keeps the backup path in the error when a migration fails', () => {
		const data = join(dir.path, 'data');
		open(data).close();
		const folder = forgeNewerMigrations('THIS IS NOT SQL;');

		expect(() => open(data, folder)).toThrowError(
			/Database migration failed.*backup.*pre-migrate-/s
		);
		expect(readdirSync(join(data, 'backups'))).toHaveLength(1);
	});

	it('fails clearly when the migrations folder is missing', () => {
		expect(() => open(dir.path, join(dir.path, 'nope'))).toThrowError(/Migrations not found/);
	});
});

describe('constraints', () => {
	it('enforces foreign keys', () => {
		const handle = open();
		expect(() => insertCard(handle, 'missing-deck')).toThrow();
	});

	it('enforces unique card keys within a deck but allows the same key in another deck', () => {
		const handle = open();
		insertDeck(handle, 'd1');
		insertDeck(handle, 'd2');
		insertCard(handle, 'd1', 'same');
		expect(() => insertCard(handle, 'd1', 'same')).toThrow(/UNIQUE/);
		expect(() => insertCard(handle, 'd2', 'same')).not.toThrow();
	});

	it('rejects invalid card types, phases, grades, and modes', () => {
		const handle = open();
		insertDeck(handle);
		const pk = insertCard(handle);
		const sql = handle.sqlite;

		expect(() =>
			sql
				.prepare(
					"insert into cards (deck_id, key, type, content, content_hash, position, created_at, updated_at) values ('d1','k','flip','{}','h',0,'x','x')"
				)
				.run()
		).toThrow(/CHECK/);
		expect(() =>
			sql
				.prepare("insert into card_state (card_pk, ordinal, due, phase) values (?, 0, 'x', 4)")
				.run(pk)
		).toThrow(/CHECK/);

		const logInsert = (grade: number, mode: string) =>
			sql
				.prepare(
					`insert into review_log (id, card_pk, ordinal, mode, grade, pre_due, pre_stability, pre_difficulty,
					 pre_elapsed_days, pre_scheduled_days, pre_learning_steps, pre_reps, pre_lapses, pre_phase, reviewed_at)
					 values (?, ?, 0, ?, ?, 'x', 0, 0, 0, 0, 0, 0, 0, 0, 'x')`
				)
				.run(`log-${grade}-${mode}`, pk, mode, grade);
		expect(() => logInsert(0, 'review')).toThrow(/CHECK/);
		expect(() => logInsert(5, 'review')).toThrow(/CHECK/);
		expect(() => logInsert(3, 'practice')).toThrow(/CHECK/);
		expect(() => logInsert(3, 'review')).not.toThrow();
		expect(() => logInsert(3, 'cram')).not.toThrow();
	});

	it('cascades card deletion to card state and review log', () => {
		const handle = open();
		insertDeck(handle);
		const pk = insertCard(handle);
		handle.sqlite
			.prepare("insert into card_state (card_pk, ordinal, due) values (?, 0, 'x')")
			.run(pk);
		handle.sqlite.prepare('delete from cards where pk = ?').run(pk);
		expect(
			(handle.sqlite.prepare('select count(*) as n from card_state').get() as { n: number }).n
		).toBe(0);
	});

	it('defaults booleans to false and tags to an empty array', () => {
		const handle = open();
		insertDeck(handle);
		insertCard(handle);
		const card = handle.db.select().from(schema.cards).get()!;
		expect(card.archived).toBe(false);
		expect(card.suspended).toBe(false);
		expect(card.tags).toEqual([]);
		expect(handle.db.select().from(schema.decks).get()!.tags).toEqual([]);
	});

	it('round trips JSON content', () => {
		const handle = open();
		insertDeck(handle);
		insertCard(handle);
		expect(handle.db.select().from(schema.cards).get()!.content).toEqual({ front: 'Q', back: 'A' });
	});
});

describe('withTx', () => {
	it('commits and returns the callback value', () => {
		const handle = open();
		const result = withTx(handle.db, (tx) => {
			tx.insert(schema.decks)
				.values({ id: 'd1', title: 'T', createdAt: now, updatedAt: now })
				.run();
			return 'done';
		});
		expect(result).toBe('done');
		expect(handle.db.select().from(schema.decks).all()).toHaveLength(1);
	});

	it('rolls everything back when the callback throws', () => {
		const handle = open();
		expect(() =>
			withTx(handle.db, (tx) => {
				tx.insert(schema.decks)
					.values({ id: 'd1', title: 'T', createdAt: now, updatedAt: now })
					.run();
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(handle.db.select().from(schema.decks).all()).toHaveLength(0);
	});

	it('uses savepoints for nested transactions', () => {
		const handle = open();
		withTx(handle.db, (outer) => {
			outer
				.insert(schema.decks)
				.values({ id: 'outer', title: 'T', createdAt: now, updatedAt: now })
				.run();
			expect(() =>
				outer.transaction((inner) => {
					inner
						.insert(schema.decks)
						.values({ id: 'inner', title: 'T', createdAt: now, updatedAt: now })
						.run();
					throw new Error('inner failure');
				})
			).toThrow('inner failure');
		});
		expect(
			handle.db
				.select()
				.from(schema.decks)
				.all()
				.map((d) => d.id)
		).toEqual(['outer']);
	});

	it('refuses an asynchronous callback instead of leaving a transaction open', () => {
		const handle = open();
		expect(() => withTx(handle.db, (async () => 1) as never)).toThrow();
		insertDeck(handle); // the connection is still usable
	});
});

describe('backupTo', () => {
	it('writes a consistent snapshot that contains current data', () => {
		const handle = open();
		insertDeck(handle);
		const dest = join(dir.path, 'out', 'snapshot.db');
		backupTo(handle.sqlite, dest);

		const snapshot = new Database(dest, { readonly: true });
		try {
			expect((snapshot.prepare('select count(*) as n from decks').get() as { n: number }).n).toBe(
				1
			);
			expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
		} finally {
			snapshot.close();
		}
	});

	it('refuses to overwrite an existing file', () => {
		const handle = open();
		const dest = join(dir.path, 'snapshot.db');
		mkdirSync(dir.path, { recursive: true });
		writeFileSync(dest, 'keep me');
		expect(() => backupTo(handle.sqlite, dest)).toThrow(/Refusing to overwrite/);
		expect(readFileSync(dest, 'utf8')).toBe('keep me');
	});
});

describe('operational safeguards', () => {
	it('refuses a database written by a newer version, and leaves it unchanged', () => {
		const first = open();
		first.sqlite
			.prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
			.run('from-the-future', Date.now() + 10 * 365 * 24 * 3600 * 1000);
		first.close();
		const before = readFileSync(join(dir.path, 'tessera.db'));

		expect(() => open()).toThrow(DatabaseTooNewError);
		expect(() => open()).toThrow(/newer version of Tessera/);
		expect(() => open()).toThrow(/backups/);
		expect(readFileSync(join(dir.path, 'tessera.db')).equals(before)).toBe(true);
		// The failed attempts must not leave the file locked or add a backup.
		expect(readdirSync(join(dir.path, 'backups'))).toEqual([]);
	});

	it('explains a damaged database file by name and leaves it alone', () => {
		mkdirSync(dir.path, { recursive: true });
		const file = join(dir.path, 'tessera.db');
		writeFileSync(file, Buffer.from('this is not a database '.repeat(300)));
		const before = readFileSync(file);

		let message = '';
		try {
			open();
		} catch (error) {
			expect(error).toBeInstanceOf(DatabaseOpenError);
			message = (error as Error).message;
		}
		expect(message).toContain(file);
		expect(message).toMatch(/damaged or is not a Tessera database/);
		expect(message).toMatch(/Restore the most recent backup/);
		expect(readFileSync(file).equals(before)).toBe(true);
	});

	it('takes the write lock when a transaction begins, not at its first write', () => {
		const handle = open();
		const other = new Database(handle.path);
		other.pragma('busy_timeout = 0');
		try {
			withTx(handle.db, (tx) => {
				// Only a read so far. A deferred transaction would not hold the write lock yet.
				tx.select().from(schema.settings).all();
				expect(() => other.exec('BEGIN IMMEDIATE')).toThrow(/locked|busy/i);
			});
			// Once committed, the other connection can take it.
			other.exec('BEGIN IMMEDIATE');
			other.exec('ROLLBACK');
		} finally {
			other.close();
		}
	});

	it('rolls back as before when the callback throws', () => {
		const handle = open();
		expect(() =>
			withTx(handle.db, (tx) => {
				tx.insert(schema.decks)
					.values({ id: 'x', title: 'X', createdAt: now, updatedAt: now })
					.run();
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(handle.db.select().from(schema.decks).all()).toHaveLength(0);
	});
});
