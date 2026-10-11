import { stringify } from 'yaml';
import { err, ok, type Result } from '../result.ts';
import type { Card, Deck } from '../schema/index.ts';
import { advanceFence, escapeLine, joinList, type FenceState } from './markdown-syntax.ts';

// Writing a deck back out, in either format, so that reading it again gives the same deck. This is what the
// export feature and a revised deck from Claude both rely on. The property tests check the round trip.

const CARD_KEY_ORDER = [
	'id',
	'type',
	'front',
	'back',
	'text',
	'answer',
	'accept',
	'choices',
	'correct',
	'extra',
	'explanation',
	'hint',
	'tags',
	'source'
];

// JSON with the keys in a fixed, readable order, so two exports of one deck are identical.
export function serializeJson(deck: Deck): string {
	const ordered = {
		tessera: deck.tessera,
		deck: {
			id: deck.deck.id,
			title: deck.deck.title,
			...(deck.deck.description === undefined ? {} : { description: deck.deck.description }),
			...(deck.deck.tags === undefined ? {} : { tags: deck.deck.tags })
		},
		cards: deck.cards.map((card) => {
			const source = card as unknown as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const key of CARD_KEY_ORDER) if (source[key] !== undefined) out[key] = source[key];
			return out;
		})
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

// Something that cannot be written in the Markdown format. The deck is still fine as JSON.
export interface SerializeProblem {
	path: string;
	code: 'leading_space' | 'unclosed_fence' | 'list_item' | 'blank_line_in_choice' | 'empty_choice';
	message: string;
}

// Trims the way the reader does: leading blank lines and trailing whitespace go, the rest is kept.
function trimValue(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.replace(/\s+$/, '');
}

// Lines for one field, with the escape applied to any line that would otherwise read as a label or heading.
// Returns the problem, if the text cannot be written, instead.
function fieldLines(
	label: string,
	first: string,
	rest: readonly string[],
	path: string
): { lines: string[]; problem?: SerializeProblem } {
	const out = [first === '' ? label : `${label} ${first}`];
	let fence: FenceState | undefined = advanceFence(undefined, first);
	for (const line of rest) {
		out.push(fence === undefined ? escapeLine(line) : line);
		fence = advanceFence(fence, line);
	}
	if (fence !== undefined) {
		return {
			lines: out,
			problem: {
				path,
				code: 'unclosed_fence',
				message: `${path} contains a code block that is never closed, which the Markdown format cannot hold. Close it, or export this deck as JSON.`
			}
		};
	}
	return { lines: out };
}

function text(
	label: string,
	value: string | undefined,
	path: string,
	problems: SerializeProblem[]
): string[] {
	if (value === undefined) return [];
	const [first = '', ...rest] = trimValue(value).split('\n');
	if (/^[ \t]/.test(first)) {
		problems.push({
			path,
			code: 'leading_space',
			message: `${path} starts with spaces, which the Markdown format drops. Remove them, or export this deck as JSON.`
		});
		return [];
	}
	const result = fieldLines(label, first, rest, path);
	if (result.problem) problems.push(result.problem);
	return result.lines;
}

function list(
	label: string,
	items: readonly string[] | undefined,
	path: string,
	problems: SerializeProblem[]
): string[] {
	if (items === undefined || items.length === 0) return [];
	const bad = items.findIndex((item) => item !== item.trim() || item.includes('\n') || item === '');
	if (bad >= 0) {
		problems.push({
			path: `${path}[${bad}]`,
			code: 'list_item',
			message: `${path}[${bad}] has spaces around it or a line break, which the Markdown format cannot hold in a list. Fix it, or export this deck as JSON.`
		});
		return [];
	}
	return [`${label} ${joinList(items)}`];
}

function choiceLines(
	card: Extract<Card, { type: 'choice' }>,
	path: string,
	problems: SerializeProblem[]
): string[] {
	const out = ['Choices:'];
	let fence: FenceState | undefined;
	card.choices.forEach((choice, index) => {
		const where = `${path}.choices[${index}]`;
		const [first = '', ...rest] = choice.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
		if (first === '') {
			problems.push({
				path: where,
				code: 'empty_choice',
				message: `${where} has no text, which the Markdown format cannot hold. Fill it in, or export this deck as JSON.`
			});
			return;
		}
		if (/^[ \t]/.test(first)) {
			problems.push({
				path: where,
				code: 'leading_space',
				message: `${where} starts with spaces, which the Markdown format drops. Remove them, or export this deck as JSON.`
			});
			return;
		}
		if (rest.some((line) => line.trim() === '')) {
			problems.push({
				path: where,
				code: 'blank_line_in_choice',
				message: `${where} has an empty line inside it, which the Markdown format cannot hold in a choice. Remove it, or export this deck as JSON.`
			});
			return;
		}
		const marker = index === card.correct ? '[x] ' : /^\[[ xX]\](?:\s|$)/.test(first) ? '[ ] ' : '';
		out.push(`- ${marker}${first}`, ...rest.map((line) => `  ${line}`));
		// Fences are tracked on the text of the choice, as the reader does, not on the bullet and indent.
		for (const content of [first, ...rest]) fence = advanceFence(fence, content);
	});
	if (fence !== undefined) {
		problems.push({
			path: `${path}.choices`,
			code: 'unclosed_fence',
			message: `${path}.choices contains a code block that is never closed, which the Markdown format cannot hold. Close it, or export this deck as JSON.`
		});
	}
	return out;
}

function cardLines(card: Card, index: number, problems: SerializeProblem[]): string[] {
	const path = `cards[${index}]`;
	const t = (label: string, value: string | undefined, field: string) =>
		text(label, value, `${path}.${field}`, problems);
	const l = (label: string, items: readonly string[] | undefined, field: string) =>
		list(label, items, `${path}.${field}`, problems);

	const lines = [card.id === undefined ? '##' : `## ${card.id}`];
	switch (card.type) {
		case 'basic':
			lines.push(...t('Q:', card.front, 'front'), ...t('A:', card.back, 'back'));
			break;
		case 'cloze':
			lines.push(...t('Cloze:', card.text, 'text'), ...t('Extra:', card.extra, 'extra'));
			break;
		case 'typed':
			lines.push(...t('Q:', card.front, 'front'), ...t('Answer:', card.answer, 'answer'));
			lines.push(...l('Accept:', card.accept, 'accept'));
			break;
		case 'choice':
			lines.push(...t('Q:', card.front, 'front'), ...choiceLines(card, path, problems));
			lines.push(...t('Explanation:', card.explanation, 'explanation'));
			break;
	}
	lines.push(
		...t('Hint:', card.hint, 'hint'),
		...l('Tags:', card.tags, 'tags'),
		...t('Source:', card.source, 'source')
	);
	return lines;
}

// The deck as Markdown, or the reasons it cannot be written in that format (it can still be JSON).
export function serializeMarkdown(deck: Deck): Result<string, SerializeProblem[]> {
	const problems: SerializeProblem[] = [];
	const front = stringify(
		{
			tessera: deck.tessera,
			id: deck.deck.id,
			title: deck.deck.title,
			...(deck.deck.description === undefined ? {} : { description: deck.deck.description }),
			...(deck.deck.tags === undefined ? {} : { tags: deck.deck.tags })
		},
		{ lineWidth: 0 }
	);
	const blocks = deck.cards.map((card, index) => cardLines(card, index, problems).join('\n'));
	if (problems.length > 0) return err(problems);
	return ok(`---\n${front}---\n\n${blocks.join('\n\n')}\n`);
}
