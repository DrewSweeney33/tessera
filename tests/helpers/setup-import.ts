import type { Deck } from '#lib/core/schema/index.ts';
import type { Clock } from '#lib/server/clock.ts';
import type { Db } from '#lib/server/db/index.ts';
import { commitImport } from '#lib/server/import/index.ts';

// Imports a deck through the real import, as a test's setup. Throws if the import is refused, so a test never runs
// against a database that is missing what it expects.
export function importForSetup(db: Db, deck: Deck, clock: Clock): void {
	const result = commitImport(db, deck, { archiveMissing: false, format: 'json' }, clock);
	if (!result.ok) throw new Error('setup import failed');
}
