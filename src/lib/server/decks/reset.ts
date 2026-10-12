import { err, ok, type Result } from '#lib/core/result.ts';
import { withSnapshot, type SnapshotInfo, type WithSnapshotOptions } from '../backups/index.ts';
import { withTx } from '../db/tx.ts';
import {
	countReviewsForDeck,
	getDeck,
	insertDeckReset,
	resetStatesForDeck
} from '../repos/index.ts';
import type { DeleteContext } from './trash.ts';

// Start over (US-14, ADR-013). Every review item of one deck goes back to a card that was never studied. What was
// reviewed stays in the review log (statistics and the audit trail are not lost), and a row in deck_resets marks
// where the schedule's history starts again. It is separate from practising a deck again, which never changes the
// schedule.

export type ResetProblem = { kind: 'not_found' } | { kind: 'confirmation_mismatch' };

export interface Reset {
	// The copy taken before anything changed. Restoring it brings the progress back.
	snapshot: SnapshotInfo;
	// Review items put back to new.
	items: number;
	// Reviews in the log for this deck, which stay.
	reviews: number;
}

// Needs the deck's title typed (surrounding space is ignored, the rest must match exactly) and a deck that is in the
// deck list: a deck in the Trash is not found. A snapshot is taken first, and if it cannot be written nothing
// changes and the error goes to the caller. The reset and its record are one transaction.
export function resetDeckProgress(
	context: DeleteContext,
	deckId: string,
	typedTitle: string,
	options: { write?: WithSnapshotOptions['write'] } = {}
): Result<Reset, ResetProblem> {
	const { db } = context;
	const deck = getDeck(db, deckId);
	if (!deck || deck.archived) return err({ kind: 'not_found' });
	if (typedTitle.trim() !== deck.title.trim()) return err({ kind: 'confirmation_mismatch' });

	const reviews = countReviewsForDeck(db, deckId);
	const { snapshot, value: items } = withSnapshot(
		context.sqlite,
		context.dataDir,
		{
			kind: 'pre-reset',
			subject: deckId,
			clock: context.clock,
			...(options.write ? { write: options.write } : {})
		},
		() =>
			withTx(db, (tx) => {
				const now = context.clock.now().toISOString();
				const count = resetStatesForDeck(tx, deckId, now);
				insertDeckReset(tx, { deckId, resetAt: now, items: count });
				return count;
			})
	);
	return ok({ snapshot, items, reviews });
}
