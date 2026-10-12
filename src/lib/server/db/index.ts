import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';
import { createDb, openSqlite, type Db, type Sqlite } from './client.ts';
import { seedSettings } from './defaults.ts';
import { runMigrations, type MigrationReport } from './migrate.ts';

export { backupTo } from './backup.ts';
export { DatabaseTooNewError } from './migrate.ts';
export { withTx } from './tx.ts';
export type { Db, Executor, Sqlite, Tx } from './client.ts';
export type { MigrationReport } from './migrate.ts';
export * as schema from './schema.ts';

export interface DatabaseHandle {
	db: Db;
	sqlite: Sqlite;
	path: string;
	migration: MigrationReport;
	close(): void;
}

export interface OpenOptions {
	dataDir: string;
	clock: Clock;
	log?: Logger;
	// Folder of generated migrations. Defaults to ./drizzle relative to the working directory.
	migrationsFolder?: string;
}

export class DatabaseOpenError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'DatabaseOpenError';
	}
}

// SQLite's own messages ("file is not a database") say nothing about which file or what to do. A
// damaged database is the failure an operator most needs help with, so name the file and the fix.
function explainOpenFailure(path: string, cause: unknown): Error {
	const message = cause instanceof Error ? cause.message : String(cause);
	const code = (cause as { code?: string } | null)?.code ?? '';
	if (
		code === 'SQLITE_NOTADB' ||
		code === 'SQLITE_CORRUPT' ||
		/not a database|malformed/i.test(message)
	) {
		return new DatabaseOpenError(
			`The database file ${path} is damaged or is not a Tessera database (${message}). ` +
				`It was not changed. Restore the most recent backup, then start Tessera again. ` +
				`Backups made before upgrades are in ${join(path, '..', 'backups')}.`,
			{ cause }
		);
	}
	if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
		return new DatabaseOpenError(
			`The database file ${path} is locked by another process (${message}). ` +
				`Stop any other Tessera instance or tool that is using the same data folder.`,
			{ cause }
		);
	}
	if (
		code.startsWith('SQLITE_CANTOPEN') ||
		code.startsWith('SQLITE_READONLY') ||
		code.startsWith('SQLITE_IOERR') ||
		code === 'SQLITE_FULL'
	) {
		return new DatabaseOpenError(
			`Cannot use the database file ${path} (${code}: ${message}). ` +
				`Check that the data folder is writable by the user Tessera runs as and that the disk is not full.`,
			{ cause }
		);
	}
	return cause instanceof Error ? cause : new Error(message);
}

// The operations guide puts manual backups in <dataDir>/backups, and upgrade backups go there too. A fresh
// install has made no upgrade backup, so the folder is made at start. Without it the documented backup
// command fails with SQLITE_CANTOPEN on its first run. Whatever is already there is left alone.
function ensureBackupsFolder(dataDir: string): void {
	const folder = join(dataDir, 'backups');
	try {
		mkdirSync(folder, { recursive: true });
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		throw new DatabaseOpenError(
			code === 'EEXIST' || code === 'ENOTDIR'
				? `Cannot create the backups folder ${folder}: a file with that name is in the way (it is not a folder). ` +
						`Move or delete that file and start again.`
				: `Cannot create the backups folder ${folder} (${code ?? 'unknown error'}). ` +
						`Check that the data folder is writable by the user Tessera runs as and that the disk is not full.`,
			{ cause }
		);
	}
}

// Opens (creating if needed) the database in dataDir, applies migrations, and seeds settings.
export function openDatabase(options: OpenOptions): DatabaseHandle {
	mkdirSync(options.dataDir, { recursive: true });
	ensureBackupsFolder(options.dataDir);
	const path = join(options.dataDir, 'tessera.db');
	let sqlite: Sqlite;
	try {
		sqlite = openSqlite(path);
	} catch (cause) {
		throw explainOpenFailure(path, cause);
	}
	const db = createDb(sqlite);

	try {
		const migration = runMigrations(db, {
			migrationsFolder: options.migrationsFolder ?? resolve('drizzle'),
			dataDir: options.dataDir,
			clock: options.clock,
			...(options.log ? { log: options.log } : {})
		});
		seedSettings(sqlite);
		options.log?.info('database ready', { path, migrationsApplied: migration.pending });
		return { db, sqlite, path, migration, close: () => sqlite.close() };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}
