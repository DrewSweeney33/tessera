import type { Db, Tx } from './client.ts';

// Runs fn in one SQLite transaction. The callback must be synchronous: better-sqlite3 is
// synchronous, so an `await` inside would leave the transaction half open. Throwing rolls back.
// Nested calls inside a transaction become savepoints.
export function withTx<T>(db: Db, fn: (tx: Tx) => T): T {
	return db.transaction((tx) => fn(tx));
}
