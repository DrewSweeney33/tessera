import { listClozeOrdinals } from '../cloze.ts';
import type { Card, CardType } from './card.ts';

// A card reduced to what identity and change detection care about (ADR-002).
// Equivalent input (CRLF versus LF, composed versus decomposed accents, trailing spaces,
// tag order) normalizes to the same value, so cosmetic edits never count as changes.
export interface NormalizedCard {
	// The author-supplied id, if any. This becomes the card key.
	id: string | undefined;
	type: CardType;
	// Type-specific authored fields, normalized. Stored in the cards.content column.
	content: Record<string, unknown>;
	// Sorted and de-duplicated.
	tags: string[];
	source: string | undefined;
}

function text(value: string): string {
	return value
		.normalize('NFC')
		.replace(/\r\n?/g, '\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.trimEnd();
}

// Order does not matter for sets such as tags and accepted answers.
function set(values: readonly string[] | undefined): string[] {
	if (!values) return [];
	return [...new Set(values.map(text).filter((v) => v.length > 0))].sort();
}

function contentOf(card: Card): Record<string, unknown> {
	const hint = card.hint === undefined ? {} : { hint: text(card.hint) };
	switch (card.type) {
		case 'basic':
			return { front: text(card.front), back: text(card.back), ...hint };
		case 'cloze':
			return {
				text: text(card.text),
				...(card.extra === undefined ? {} : { extra: text(card.extra) }),
				...hint
			};
		case 'typed': {
			const accept = set(card.accept);
			return {
				front: text(card.front),
				answer: text(card.answer),
				...(accept.length > 0 ? { accept } : {}),
				...hint
			};
		}
		case 'choice':
			return {
				front: text(card.front),
				// Order matters: `correct` is an index into this list.
				choices: card.choices.map(text),
				correct: card.correct,
				...(card.explanation === undefined ? {} : { explanation: text(card.explanation) }),
				...hint
			};
	}
}

export function normalizeCard(card: Card): NormalizedCard {
	return {
		id: card.id,
		type: card.type,
		content: contentOf(card),
		tags: set(card.tags),
		source: card.source === undefined ? undefined : text(card.source)
	};
}

// The text a card is known by when it has no id: the question, or the cloze text.
export function primaryText(card: NormalizedCard): string {
	const value = card.type === 'cloze' ? card.content['text'] : card.content['front'];
	return typeof value === 'string' ? value : '';
}

// The review items a card produces: one per cloze number for cloze cards, otherwise one (ordinal 0).
export function reviewOrdinals(card: NormalizedCard): number[] {
	if (card.type !== 'cloze') return [0];
	return listClozeOrdinals(primaryText(card));
}

// JSON with sorted keys and no undefined values, so equal data always serializes identically.
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}
