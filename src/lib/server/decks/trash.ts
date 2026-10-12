import { err, ok, type Result } from '#lib/core/result.ts';
import { withSnapshot, type SnapshotInfo, type WithSnapshotOptions } from '../backups/index.ts';
import type { Clock } from '../clock.ts';
import type { Db, Sqlite } from '../db/client.ts';
import { withTx } from '../db/tx.ts';
import type { DeckRow } from '../db/schema.ts';
import {
	countActiveCardsForDecks,
	countAllCardsInDeck,
	countReviewsForDeck,
	deleteDeckAndData,
	getDeck,
	listArchivedDecks,
	setDeckArchived
} from '../repos/index.ts';

// The Trash (US-13, ADR-013). Deleting a deck only sets its `archived` flag: the deck leaves every list and every
// study queue, and its cards, schedule, and history stay exactly as they were. From the Trash it is restored with
// one flag, or deleted for good, which needs the title typed and a snapshot first.

export type TrashProblem =
	{ kind: 'not_found' } | { kind: 'not_in_trash' } | { kind: 'confirmation_mismatch' };

// Moves a deck to the Trash. A deck that is already there is left alone, so a double click is not an error.
// `updatedAt` becomes the time it went to the Trash, which the Trash page shows.
export function moveToTrash(
	db: Db,
	deckId: string,
	now: string
): Result<DeckRow, { kind: 'not_found' }> {
	return setTrashed(db, deckId, true, now);
}

export function restoreFromTrash(
	db: Db,
	deckId: string,
	now: string
): Result<DeckRow, { kind: 'not_found' }> {
	return setTrashed(db, deckId, false, now);
}

function setTrashed(
	db: Db,
	deckId: string,
	archived: boolean,
	now: string
): Result<DeckRow, { kind: 'not_found' }> {
	return withTx(db, (tx) => {
		const deck = getDeck(tx, deckId);
		if (!deck) return err({ kind: 'not_found' as const });
		if (deck.archived === archived) return ok(deck);
		setDeckArchived(tx, deckId, archived, now);
		return ok({ ...deck, archived, updatedAt: now });
	});
}

export interface TrashedDeck {
	deck: DeckRow;
	// Cards still in the deck (cards removed from it earlier are not counted).
	cardCount: number;
	// Review history that permanent deletion would erase.
	reviewCount: number;
}

// Every deck in the Trash, the most recently deleted first.
export function listTrash(db: Db): TrashedDeck[] {
	const rows = listArchivedDecks(db);
	const cardCounts = countActiveCardsForDecks(
		db,
		rows.map((row) => row.id)
	);
	return rows.map((deck) => ({
		deck,
		cardCount: cardCounts.get(deck.id) ?? 0,
		reviewCount: countReviewsForDeck(db, deck.id)
	}));
}

export interface DeleteContext {
	db: Db;
	sqlite: Sqlite;
	dataDir: string;
	clock: Clock;
}

export interface Deleted {
	// The copy taken before anything was removed. Restoring it brings the deck back.
	snapshot: SnapshotInfo;
	cards: number;
	reviews: number;
}

// Deletes a deck that is in the Trash, for good, with its cards, schedule, review history, and import history.
// Needs the deck's title typed (surrounding space is ignored, the rest must match exactly) and takes a snapshot
// first: if the snapshot cannot be written, nothing is deleted and the error goes to the caller. The removal is
// one transaction, so it happens entirely or not at all.
export function deleteDeckForever(
	context: DeleteContext,
	deckId: string,
	typedTitle: string,
	options: { write?: WithSnapshotOptions['write'] } = {}
): Result<Deleted, TrashProblem> {
	const { db } = context;
	const deck = getDeck(db, deckId);
	if (!deck) return err({ kind: 'not_found' });
	if (!deck.archived) return err({ kind: 'not_in_trash' });
	if (typedTitle.trim() !== deck.title.trim()) return err({ kind: 'confirmation_mismatch' });

	const cards = countAllCardsInDeck(db, deckId);
	const reviews = countReviewsForDeck(db, deckId);

	const { snapshot } = withSnapshot(
		context.sqlite,
		context.dataDir,
		{
			kind: 'pre-delete',
			subject: deckId,
			clock: context.clock,
			...(options.write ? { write: options.write } : {})
		},
		() => withTx(db, (tx) => deleteDeckAndData(tx, deckId))
	);
	return ok({ snapshot, cards, reviews });
}
