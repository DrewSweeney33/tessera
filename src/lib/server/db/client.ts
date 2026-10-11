import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof schema> & { $client: Sqlite };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Pragmas from ADR-001. WAL gives crash safety and concurrent reads, and busy_timeout
// absorbs the brief lock a backup or migration may hold.
export function openSqlite(path: string): Sqlite {
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');
	return sqlite;
}

export function createDb(sqlite: Sqlite): Db {
	return drizzle(sqlite, { schema });
}
