import { err, ok, type Result } from '#lib/core/result.ts';
import type { CardType } from '#lib/core/schema/card.ts';
import type { Deck } from '#lib/core/schema/deck.ts';
import type { ImportError } from '#lib/core/schema/errors.ts';
import {
	canonicalJson,
	normalizeCard,
	reviewOrdinals,
	type NormalizedCard
} from '#lib/core/schema/normalize.ts';
import type { Executor } from '../db/client.ts';
import type { CardRow, CardStateRow } from '../db/schema.ts';
import { getDeck, listCardsForDeck, listStatesForCards } from '../repos/index.ts';
import { fallbackKey, hashCard } from './hash.ts';

// What an import will do, computed without writing anything (ADR-002).
// 'type_changed' resets the card's progress. 'restored' brings an archived card back.
export type CardAction = 'new' | 'unchanged' | 'updated' | 'type_changed' | 'restored';

export interface PlannedCard {
	// Position in the file, which becomes the card's position.
	index: number;
	key: string;
	generatedKey: boolean;
	action: CardAction;
	// True when the card existed but was archived and the file brings it back.
	restored: boolean;
	// True when only the file position changed. Applied silently and counted as unchanged.
	reposition: boolean;
	type: CardType;
	content: Record<string, unknown>;
	tags: string[];
	source: string | undefined;
	contentHash: string;
	// For updated cards: the fields that differ, such as "back" or "tags".
	changedFields: string[];
	// The review items this card should have: one per cloze number, otherwise [0].
	ordinals: number[];
	existingPk: number | undefined;
	// True when the type changed, so all review state is replaced.
	resetProgress: boolean;
	ordinalsToAdd: number[];
	ordinalsToRestore: number[];
	ordinalsToArchive: number[];
}

export interface AbsentCard {
	pk: number;
	key: string;
	archived: boolean;
}

export interface ImportWarning {
	code: string;
	message: string;
	paths: string[];
}

export interface ImportCounts {
	new: number;
	updated: number;
	typeChanged: number;
	restored: number;
	unchanged: number;
	// Existing cards that the file does not mention.
	absent: number;
	// Absent cards that will be archived because archiveMissing was requested.
	archivedMissing: number;
}

export interface ImportPlan {
	deck: {
		id: string;
		title: string;
		description: string | undefined;
		tags: string[];
		action: 'created' | 'updated';
		changed: boolean;
	};
	cards: PlannedCard[];
	absent: AbsentCard[];
	archiveMissing: boolean;
	// Primary keys of absent, active cards to archive. Empty unless archiveMissing is set.
	toArchive: number[];
	counts: ImportCounts;
	warnings: ImportWarning[];
}

export interface PlanOptions {
	archiveMissing: boolean;
}

function changedFieldsOf(existing: CardRow, card: NormalizedCard): string[] {
	const before = existing.content;
	const keys = new Set([...Object.keys(before), ...Object.keys(card.content)]);
	const changed = [...keys].filter(
		(k) => canonicalJson(before[k]) !== canonicalJson(card.content[k])
	);
	if (canonicalJson(existing.tags) !== canonicalJson(card.tags)) changed.push('tags');
	if ((existing.source ?? undefined) !== card.source) changed.push('source');
	return changed.sort();
}

function groupByCard(states: CardStateRow[]): Map<number, CardStateRow[]> {
	const grouped = new Map<number, CardStateRow[]>();
	for (const state of states) {
		const list = grouped.get(state.cardPk);
		if (list) list.push(state);
		else grouped.set(state.cardPk, [state]);
	}
	return grouped;
}

// Pure with respect to the database: it only reads. The same function is re-run inside the
// commit transaction so a stale preview can never be applied (ADR-002).
export function planImport(
	x: Executor,
	deck: Deck,
	options: PlanOptions
): Result<ImportPlan, ImportError[]> {
	const deckId = deck.deck.id;
	const existingDeck = getDeck(x, deckId);
	const existingCards = existingDeck ? listCardsForDeck(x, deckId) : [];
	const byKey = new Map(existingCards.map((card) => [card.key, card]));
	const statesByCard = groupByCard(
		listStatesForCards(
			x,
			existingCards.map((c) => c.pk)
		)
	);

	// Resolve every card's key first. Two cards with one key would silently merge.
	const errors: ImportError[] = [];
	const firstIndexOfKey = new Map<string, number>();
	const prepared = deck.cards.map((card, index) => {
		const normalized = normalizeCard(card);
		const generatedKey = normalized.id === undefined;
		const key = normalized.id ?? fallbackKey(normalized);
		const first = firstIndexOfKey.get(key);
		if (first === undefined) {
			firstIndexOfKey.set(key, index);
		} else {
			errors.push({
				path: `cards[${index}]`,
				code: 'duplicate_id',
				message: `cards[${index}] and cards[${first}] resolve to the same card key "${key}". Cards without an id are identified by their type and text, so identical cards cannot be told apart. Give each card its own "id".`
			});
		}
		return { index, normalized, generatedKey, key };
	});
	if (errors.length > 0) return err(errors);

	const planned: PlannedCard[] = prepared.map(({ index, normalized, generatedKey, key }) => {
		const contentHash = hashCard(normalized);
		const ordinals = reviewOrdinals(normalized);
		const base = {
			index,
			key,
			generatedKey,
			type: normalized.type,
			content: normalized.content,
			tags: normalized.tags,
			source: normalized.source,
			contentHash,
			ordinals
		};

		const existing = byKey.get(key);
		if (!existing) {
			return {
				...base,
				action: 'new',
				restored: false,
				reposition: false,
				changedFields: [],
				existingPk: undefined,
				resetProgress: false,
				ordinalsToAdd: ordinals,
				ordinalsToRestore: [],
				ordinalsToArchive: []
			};
		}

		const reposition = existing.position !== index;

		if (existing.type !== normalized.type) {
			return {
				...base,
				action: 'type_changed',
				restored: existing.archived,
				reposition,
				changedFields: changedFieldsOf(existing, normalized),
				existingPk: existing.pk,
				resetProgress: true,
				ordinalsToAdd: ordinals,
				ordinalsToRestore: [],
				ordinalsToArchive: []
			};
		}

		const states = statesByCard.get(existing.pk) ?? [];
		const have = new Map(states.map((s) => [s.ordinal, s]));
		const ordinalsToAdd = ordinals.filter((o) => !have.has(o));
		const ordinalsToRestore = ordinals.filter((o) => have.get(o)?.archived === true);
		const ordinalsToArchive = states
			.filter((s) => !s.archived && !ordinals.includes(s.ordinal))
			.map((s) => s.ordinal);

		let action: CardAction;
		if (existing.contentHash !== contentHash) action = 'updated';
		else if (existing.archived) action = 'restored';
		else action = 'unchanged';

		return {
			...base,
			action,
			restored: existing.archived,
			reposition,
			changedFields: action === 'updated' ? changedFieldsOf(existing, normalized) : [],
			existingPk: existing.pk,
			resetProgress: false,
			ordinalsToAdd,
			ordinalsToRestore,
			ordinalsToArchive
		};
	});

	const fileKeys = new Set(planned.map((card) => card.key));
	const absent: AbsentCard[] = existingCards
		.filter((card) => !fileKeys.has(card.key))
		.map((card) => ({ pk: card.pk, key: card.key, archived: card.archived }));
	const toArchive = options.archiveMissing
		? absent.filter((card) => !card.archived).map((card) => card.pk)
		: [];

	const count = (action: CardAction) => planned.filter((card) => card.action === action).length;
	const generated = planned.filter((card) => card.generatedKey);
	const warnings: ImportWarning[] = [];
	if (generated.length > 0) {
		warnings.push({
			code: 'generated_id',
			message: `${generated.length} card${generated.length === 1 ? ' has' : 's have'} no id, so ${generated.length === 1 ? 'it is' : 'they are'} identified by a hash of the text. Editing that text creates a new card and orphans its review history. Add an "id" to each card to keep history across edits.`,
			paths: generated.slice(0, 5).map((card) => `cards[${card.index}]`)
		});
	}

	const deckChanged =
		!existingDeck ||
		existingDeck.title !== deck.deck.title ||
		(existingDeck.description ?? undefined) !== deck.deck.description ||
		canonicalJson(existingDeck.tags) !== canonicalJson(deck.deck.tags ?? []);

	return ok({
		deck: {
			id: deckId,
			title: deck.deck.title,
			description: deck.deck.description,
			tags: deck.deck.tags ?? [],
			action: existingDeck ? 'updated' : 'created',
			changed: deckChanged
		},
		cards: planned,
		absent,
		archiveMissing: options.archiveMissing,
		toArchive,
		counts: {
			new: count('new'),
			updated: count('updated'),
			typeChanged: count('type_changed'),
			restored: count('restored'),
			unchanged: count('unchanged'),
			absent: absent.length,
			archivedMissing: toArchive.length
		},
		warnings
	});
}
