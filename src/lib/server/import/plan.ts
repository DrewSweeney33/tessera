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

// One field of an existing card that the file changes, as text for the preview.
export interface FieldChange {
	field: string;
	before: string | undefined;
	after: string | undefined;
}

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
	// The same fields with their old and new values, for the preview. Includes "type" for a type change.
	changes: FieldChange[];
	// For a type change: how many of the card's review items have history that will be erased.
	progressLost: number;
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
		// As written in the file. Undefined means the file did not mention it, so the stored value is kept.
		description: string | undefined;
		tags: string[] | undefined;
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

function show(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
	return JSON.stringify(value);
}

function changesOf(existing: CardRow, card: NormalizedCard): FieldChange[] {
	const before = existing.content;
	const keys = new Set([...Object.keys(before), ...Object.keys(card.content)]);
	const changes: FieldChange[] = [...keys]
		.filter((k) => canonicalJson(before[k]) !== canonicalJson(card.content[k]))
		.map((field) => ({ field, before: show(before[field]), after: show(card.content[field]) }));
	if (canonicalJson(existing.tags) !== canonicalJson(card.tags)) {
		changes.push({ field: 'tags', before: show(existing.tags), after: show(card.tags) });
	}
	if ((existing.source ?? undefined) !== card.source) {
		changes.push({ field: 'source', before: show(existing.source), after: show(card.source) });
	}
	return changes.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}

const changedFieldsOf = (existing: CardRow, card: NormalizedCard): string[] =>
	changesOf(existing, card).map((change) => change.field);

function groupByCard(states: CardStateRow[]): Map<number, CardStateRow[]> {
	const grouped = new Map<number, CardStateRow[]>();
	for (const state of states) {
		const list = grouped.get(state.cardPk);
		if (list) list.push(state);
		else grouped.set(state.cardPk, [state]);
	}
	return grouped;
}

const list = (keys: string[], shown = 5): string =>
	keys
		.slice(0, shown)
		.map((key) => `"${key}"`)
		.join(', ') + (keys.length > shown ? `, and ${keys.length - shown} more` : '');

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// A retype erases the card's progress, so say so before the import, not after.
function typeChangeWarnings(planned: PlannedCard[]): ImportWarning[] {
	const retyped = planned.filter((card) => card.action === 'type_changed');
	if (retyped.length === 0) return [];
	const lost = retyped.reduce((sum, card) => sum + card.progressLost, 0);
	const history =
		lost > 0
			? ` ${lost} review ${plural(lost, 'item has', 'items have')} history that will be erased.`
			: ' None of them has been studied yet.';
	return [
		{
			code: 'type_changed',
			message: `${retyped.length} ${plural(retyped.length, 'card changes', 'cards change')} type (${list(retyped.map((card) => card.key))}), so ${plural(retyped.length, 'its', 'their')} review progress starts over.${history} If that was not meant, ask Claude to keep each card's type.`,
			paths: retyped.slice(0, 5).map((card) => `cards[${card.index}]`)
		}
	];
}

// Two signs that ids were changed in a revised deck, which would leave the old cards behind with their
// history and add new ones with none. The preview says so while it can still be fixed.
function missingCardWarnings(
	planned: PlannedCard[],
	existingCards: CardRow[],
	absent: AbsentCard[],
	archiveMissing: boolean
): ImportWarning[] {
	const activeAbsent = absent.filter((card) => !card.archived);
	if (activeAbsent.length === 0) return [];
	const consequence = archiveMissing
		? ' Because "Archive cards that are not in this file" is on, the old ones would also be archived.'
		: ' The old cards stay, with their history.';

	// A new card with exactly the content of a missing one is that card under a new id.
	const hashToAbsent = new Map<string, string[]>();
	const hashByKey = new Map(existingCards.map((card) => [card.key, card.contentHash]));
	for (const card of activeAbsent) {
		const hash = hashByKey.get(card.key);
		if (hash === undefined) continue;
		const keys = hashToAbsent.get(hash);
		if (keys) keys.push(card.key);
		else hashToAbsent.set(hash, [card.key]);
	}
	const renamed: { index: number; key: string; was: string }[] = [];
	for (const card of planned) {
		if (card.action !== 'new') continue;
		const was = hashToAbsent.get(card.contentHash)?.shift();
		if (was !== undefined) renamed.push({ index: card.index, key: card.key, was });
	}
	if (renamed.length > 0) {
		const first = renamed[0]!;
		return [
			{
				code: 'ids_changed',
				message: `${renamed.length} new ${plural(renamed.length, 'card has', 'cards have')} exactly the same content as ${plural(renamed.length, 'a card', 'cards')} missing from this file (for example "${first.was}" is now "${first.key}"), so ${plural(renamed.length, 'its id was', 'their ids were')} probably changed. Importing this creates new cards with no history.${consequence} Ask Claude to keep every id, then import again.`,
				paths: renamed.slice(0, 5).map((card) => `cards[${card.index}]`)
			}
		];
	}

	const activeBefore = existingCards.filter((card) => !card.archived).length;
	const added = planned.filter((card) => card.action === 'new').length;
	if (activeBefore >= 3 && added >= 3 && activeAbsent.length * 2 >= activeBefore) {
		return [
			{
				code: 'mostly_replaced',
				message: `${activeAbsent.length} of the ${activeBefore} cards in this deck are not in this file, and the file adds ${added} new ones. If this is a revised version of the deck, the ids probably changed.${consequence} If it is a different deck, give it a different deck id.`,
				paths: []
			}
		];
	}
	return [];
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
				changes: [],
				progressLost: 0,
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
				changes: [
					{ field: 'type', before: existing.type, after: normalized.type },
					...changesOf(existing, normalized)
				],
				progressLost: (statesByCard.get(existing.pk) ?? []).filter((s) => s.reps > 0).length,
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
			changes: action === 'updated' ? changesOf(existing, normalized) : [],
			progressLost: 0,
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

	if (existingDeck?.archived) {
		warnings.push({
			code: 'deck_in_trash',
			message:
				'This deck is in the Trash. Importing it brings it back to your deck list, with everything you studied.',
			paths: []
		});
	}
	warnings.push(...typeChangeWarnings(planned));
	warnings.push(...missingCardWarnings(planned, existingCards, absent, options.archiveMissing));

	// Only fields the file provides can change an existing deck. Omitted ones are left alone.
	// A deck in the Trash is brought back by an import, so that is a change even when nothing else is.
	const deckChanged =
		!existingDeck ||
		existingDeck.archived ||
		existingDeck.title !== deck.deck.title ||
		(deck.deck.description !== undefined &&
			(existingDeck.description ?? undefined) !== deck.deck.description) ||
		(deck.deck.tags !== undefined &&
			canonicalJson(existingDeck.tags) !== canonicalJson(deck.deck.tags));

	return ok({
		deck: {
			id: deckId,
			title: deck.deck.title,
			description: deck.deck.description,
			tags: deck.deck.tags,
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
