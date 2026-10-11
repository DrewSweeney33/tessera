import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';
import { backupTo } from './backup.ts';
import type { Db } from './client.ts';

export class DatabaseTooNewError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DatabaseTooNewError';
	}
}

export interface MigrationReport {
	pending: number;
	backupPath: string | undefined;
}

interface JournalEntry {
	when: number;
	tag: string;
}

function readJournal(migrationsFolder: string): JournalEntry[] {
	const file = join(migrationsFolder, 'meta', '_journal.json');
	if (!existsSync(file)) {
		throw new Error(
			`Migrations not found: ${file} does not exist. Run the app from its install folder.`
		);
	}
	return (JSON.parse(readFileSync(file, 'utf8')) as { entries: JournalEntry[] }).entries;
}

function uniqueBackupPath(dataDir: string, clock: Clock): string {
	const stamp = clock.now().toISOString().replace(/[:.]/g, '-');
	let candidate = join(dataDir, 'backups', `pre-migrate-${stamp}.db`);
	for (let n = 1; existsSync(candidate); n++) {
		candidate = join(dataDir, 'backups', `pre-migrate-${stamp}-${n}.db`);
	}
	return candidate;
}

// Applies pending migrations. If the database already holds data from an earlier version,
// a snapshot is written to <dataDir>/backups first, so a bad upgrade is recoverable.
export function runMigrations(
	db: Db,
	options: { migrationsFolder: string; dataDir: string; clock: Clock; log?: Logger }
): MigrationReport {
	const sqlite = db.$client;
	const journal = readJournal(options.migrationsFolder);

	const hasHistory =
		sqlite
			.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
			.get() !== undefined;
	const lastApplied = hasHistory
		? ((
				sqlite.prepare('select max(created_at) as latest from __drizzle_migrations').get() as {
					latest: number | null;
				}
			).latest ?? 0)
		: 0;
	const pending = journal.filter((entry) => entry.when > lastApplied).length;

	// A rollback to an older image after an upgrade would otherwise open a newer database with code that
	// does not know its schema, and fail in strange ways later or damage data. Refuse, and say what to do.
	const newestKnown = journal.reduce((latest, entry) => Math.max(latest, entry.when), 0);
	if (lastApplied > newestKnown) {
		throw new DatabaseTooNewError(
			`This database was written by a newer version of Tessera than the one running now. ` +
				`Start the newer version again, or restore the backup that was made before the upgrade ` +
				`(see ${join(options.dataDir, 'backups')}). The database was not changed.`
		);
	}

	if (pending === 0) return { pending: 0, backupPath: undefined };

	let backupPath: string | undefined;
	if (hasHistory && lastApplied > 0) {
		backupPath = uniqueBackupPath(options.dataDir, options.clock);
		backupTo(sqlite, backupPath);
		options.log?.info('database backed up before migration', { backupPath, pending });
	}

	try {
		migrate(db, { migrationsFolder: options.migrationsFolder });
	} catch (cause) {
		const saved = backupPath
			? ` A backup of the previous database was saved to ${backupPath}.`
			: '';
		throw new Error(`Database migration failed.${saved}`, { cause });
	}
	return { pending, backupPath };
}
