import type { Db, Tx } from './client.ts';

// Runs fn in one SQLite transaction. The callback must be synchronous: better-sqlite3 is
// synchronous, so an `await` inside would leave the transaction half open. Throwing rolls back.
// Nested calls inside a transaction become savepoints.
//
// The transaction takes the write lock when it begins (BEGIN IMMEDIATE), not at its first write. Inside
// one process this makes no difference. When a second process uses the same database file, for example
// an old container still running during an upgrade, a deferred transaction that reads first and writes
// later fails at once with "database is locked", ignoring busy_timeout. An immediate one waits its turn.
export function withTx<T>(db: Db, fn: (tx: Tx) => T): T {
	return db.transaction((tx) => fn(tx), { behavior: 'immediate' });
}
