import type { StudyItemDto } from '#lib/core/api-types.ts';
import { clozeSides } from '#lib/core/cloze.ts';

export interface CardSides {
	// Markdown for the question and for the answer shown after Show answer.
	front: string;
	back: string;
	hint?: string;
	// A plain description of the card type for the small label above the card.
	kind: string;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

// Splits a card into the question and the answer. For a typed card the study screen adds an answer box,
// and for a choice card it shows the options itself (shuffled), so the choice question here is only the
// question and the answer side is only the explanation.
export function cardSides(item: Pick<StudyItemDto, 'type' | 'content' | 'ordinal'>): CardSides {
	const c = item.content;
	const hint = text(c['hint']) || undefined;
	const withHint = (sides: Omit<CardSides, 'hint'>): CardSides =>
		hint ? { ...sides, hint } : sides;

	switch (item.type) {
		case 'basic':
			return withHint({ kind: 'Question', front: text(c['front']), back: text(c['back']) });

		case 'cloze': {
			const sides = clozeSides(text(c['text']), item.ordinal);
			const extra = text(c['extra']);
			return withHint({
				kind: 'Fill in the blank',
				front: sides.front,
				back: extra ? `${sides.back}\n\n${extra}` : sides.back
			});
		}

		case 'typed': {
			const accept = Array.isArray(c['accept']) ? (c['accept'] as unknown[]).map(String) : [];
			const alsoAccepted =
				accept.length > 0 ? `\n\nAlso accepted: ${accept.map((a) => `\`${a}\``).join(', ')}` : '';
			return withHint({
				kind: 'Recall the answer',
				front: text(c['front']),
				back: `\`${text(c['answer'])}\`${alsoAccepted}`
			});
		}

		case 'choice': {
			return withHint({
				kind: 'Multiple choice',
				front: text(c['front']),
				back: text(c['explanation'])
			});
		}
	}
}
