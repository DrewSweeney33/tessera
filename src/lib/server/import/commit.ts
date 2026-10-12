import { err, ok, type Result } from '#lib/core/result.ts';
import type { Deck } from '#lib/core/schema/deck.ts';
import type { ImportError } from '#lib/core/schema/errors.ts';
import type { Clock } from '../clock.ts';
import { staleRevisionProblem } from '../decks/revision.ts';
import { withTx, type Db, type Tx } from '../db/index.ts';
import {
	deleteStatesForCard,
	insertCard,
	insertImportHistory,
	insertStates,
	setCardsArchived,
	setStatesArchived,
	updateCard,
	upsertDeck
} from '../repos/index.ts';
import {
	planImport,
	type ImportCounts,
	type ImportPlan,
	type ImportWarning,
	type PlannedCard
} from './plan.ts';

export interface CommitOptions {
	archiveMissing: boolean;
	// The deck revision the caller loaded (ADR-013). When given, the import is refused if the deck has changed since,
	// checked inside the transaction.
	expectedRevision?: string | undefined;
	format: 'json' | 'markdown';
	filename?: string | undefined;
}

export interface ImportResult {
	deckId: string;
	// False when the file matched the database exactly and nothing was written.
	changed: boolean;
	counts: ImportCounts;
	warnings: ImportWarning[];
	importHistoryId: number | undefined;
}

function newStateRows(cardPk: number, ordinals: number[], now: string) {
	// A new review item starts as a New card, due immediately.
	return ordinals.map((ordinal) => ({ cardPk, ordinal, due: now }));
}

function applyOrdinals(tx: Tx, cardPk: number, card: PlannedCard, now: string): void {
	insertStates(tx, newStateRows(cardPk, card.ordinalsToAdd, now));
	setStatesArchived(tx, cardPk, card.ordinalsToArchive, true);
	setStatesArchived(tx, cardPk, card.ordinalsToRestore, false);
}

function applyCard(tx: Tx, deckId: string, card: PlannedCard, now: string): void {
	const fields = {
		type: card.type,
		content: card.content,
		tags: card.tags,
		source: card.source ?? null,
		contentHash: card.contentHash,
		position: card.index
	};

	if (card.existingPk === undefined) {
		const pk = insertCard(tx, {
			deckId,
			key: card.key,
			...fields,
			createdAt: now,
			updatedAt: now
		});
		insertStates(tx, newStateRows(pk, card.ordinalsToAdd, now));
		return;
	}

	const pk = card.existingPk;
	switch (card.action) {
		case 'type_changed':
			updateCard(tx, pk, { ...fields, archived: false, updatedAt: now });
			// Review history stays in review_log. Only the schedule is replaced.
			deleteStatesForCard(tx, pk);
			insertStates(tx, newStateRows(pk, card.ordinalsToAdd, now));
			return;
		case 'updated':
		case 'restored':
			updateCard(tx, pk, { ...fields, archived: false, updatedAt: now });
			applyOrdinals(tx, pk, card, now);
			return;
		case 'unchanged':
			// Silent housekeeping: file order and any review item drift. Not counted as a change.
			if (card.reposition) updateCard(tx, pk, { position: card.index });
			applyOrdinals(tx, pk, card, now);
			return;
		case 'new':
			return;
	}
}

function changedAnything(plan: ImportPlan): boolean {
	const c = plan.counts;
	return (
		plan.deck.changed || c.new + c.updated + c.typeChanged + c.restored + c.archivedMissing > 0
	);
}

// Applies an import in one transaction (ADR-002). The plan is recomputed inside the transaction,
// so a preview that has gone stale can never be applied. Any failure rolls back everything.
export function commitImport(
	db: Db,
	deck: Deck,
	options: CommitOptions,
	clock: Clock
): Result<ImportResult, ImportError[]> {
	return withTx(db, (tx) => {
		if (options.expectedRevision !== undefined) {
			const stale = staleRevisionProblem(tx, deck.deck.id, options.expectedRevision);
			if (stale) return err([stale]);
		}
		const planned = planImport(tx, deck, { archiveMissing: options.archiveMissing });
		if (!planned.ok) return err(planned.error);
		const plan = planned.value;
		const now = clock.now().toISOString();
		const changed = changedAnything(plan);

		if (plan.deck.changed) {
			upsertDeck(
				tx,
				{
					id: plan.deck.id,
					title: plan.deck.title,
					description: plan.deck.description,
					tags: plan.deck.tags
				},
				now
			);
		}
		for (const card of plan.cards) applyCard(tx, plan.deck.id, card, now);
		setCardsArchived(tx, plan.toArchive, true, now);

		let importHistoryId: number | undefined;
		if (changed) {
			importHistoryId = insertImportHistory(tx, {
				deckId: plan.deck.id,
				format: options.format,
				filename: options.filename,
				newCount: plan.counts.new,
				updatedCount: plan.counts.updated + plan.counts.typeChanged + plan.counts.restored,
				unchangedCount: plan.counts.unchanged,
				archivedCount: plan.counts.archivedMissing,
				createdAt: now
			});
		}

		return ok({
			deckId: plan.deck.id,
			changed,
			counts: plan.counts,
			warnings: plan.warnings,
			importHistoryId
		});
	});
}
