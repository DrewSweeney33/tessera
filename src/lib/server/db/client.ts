import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';

type RunResult = Database.RunResult;

export type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof schema> & { $client: Sqlite };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
// Repositories accept either the database or an open transaction.
export type Executor = BaseSQLiteDatabase<'sync', RunResult, typeof schema>;

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
