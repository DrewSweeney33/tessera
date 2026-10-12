import type { Executor } from '../db/client.ts';
import { deckResets } from '../db/schema.ts';

// Records that a deck was started over, and how many review items went back to new.
export function insertDeckReset(
	x: Executor,
	row: { deckId: string; resetAt: string; items: number }
): void {
	x.insert(deckResets).values(row).run();
}
