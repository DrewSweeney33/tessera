import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';
import { createDb, openSqlite, type Db, type Sqlite } from './client.ts';
import { seedSettings } from './defaults.ts';
import { runMigrations, type MigrationReport } from './migrate.ts';

export { backupTo } from './backup.ts';
export { DEFAULT_SETTINGS, type SettingKey } from './defaults.ts';
export { withTx } from './tx.ts';
export type { Db, Sqlite, Tx } from './client.ts';
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

// Opens (creating if needed) the database in dataDir, applies migrations, and seeds settings.
export function openDatabase(options: OpenOptions): DatabaseHandle {
	mkdirSync(options.dataDir, { recursive: true });
	const path = join(options.dataDir, 'tessera.db');
	const sqlite = openSqlite(path);
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
