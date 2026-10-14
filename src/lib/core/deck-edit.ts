import type { DeckCardDto, DeckDocumentDto } from './api-types.ts';
import { parseCloze, validateCloze, type ClozeNode } from './cloze.ts';
import { compareText } from './compare.ts';
import { CLOZE_MARKER_PATTERN, LIMITS, TAG_MESSAGE, TAG_PATTERN } from './schema/limits.ts';

// The pure part of the deck editor (ADR-013). Nothing here touches the page or the network, so it is tested
// without a browser. The server checks every save again; what this file does is let the editor say what is
// wrong beside the field, before the save, in the same words the server uses.

export const CARD_TYPES = ['basic', 'cloze', 'typed', 'choice'] as const;
export type EditableCardType = (typeof CARD_TYPES)[number];

export interface EditProblem {
	// The field the message belongs to: front, back, text, answer, accept, choices, choices[2], correct, hint,
	// extra, explanation, source, tags, type. For the deck: title, description, tags, cards.
	field: string;
	message: string;
}

// A number from 0 up to (not including) 1, from the browser or Node random source.
function randomUnit(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

const HEX = '0123456789abcdef';

// A new card id: "card-" and eight hex digits, never one that is already taken. If luck keeps handing back a
// taken id (a fixed random function, in a test), a counter is added so the loop always ends.
export function newCardId(taken: ReadonlySet<string>, random: () => number = randomUnit): string {
	let digits = '';
	for (let i = 0; i < 8; i++) digits += HEX[Math.min(15, Math.floor(random() * 16))];
	const base = `card-${digits}`;
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export function blankCard(type: EditableCardType, id: string): DeckCardDto {
	switch (type) {
		case 'basic':
			return { id, type, front: '', back: '' };
		case 'cloze':
			return { id, type, text: '' };
		case 'typed':
			return { id, type, front: '', answer: '' };
		case 'choice':
			return { id, type, front: '', choices: ['', ''], correct: 0 };
	}
}

const isBlank = (value: unknown): boolean => typeof value !== 'string' || !/\S/.test(value);

function cleanTags(tags: unknown): string[] {
	if (!Array.isArray(tags)) return [];
	const seen = new Set<string>();
	for (const tag of tags) {
		if (typeof tag !== 'string') continue;
		const trimmed = tag.trim();
		if (trimmed !== '') seen.add(trimmed);
	}
	return [...seen];
}

// Optional text fields: left out when blank, exactly as typed otherwise.
const OPTIONAL_TEXT = ['hint', 'source', 'extra', 'explanation'] as const;

// A card the way a save needs it. Optional fields with nothing in them are left out (the deck format refuses a
// blank hint), tags are trimmed and de-duplicated, and blank accepted answers are dropped. The main text is
// left exactly as typed: the server decides what counts as a change, so editing never rewrites a card the
// person did not touch. Fields this code does not know about are carried through.
export function tidyCard(card: DeckCardDto): DeckCardDto {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(card)) {
		if (value === undefined || value === null) continue;
		out[key] = value;
	}
	for (const field of OPTIONAL_TEXT) {
		if (field in out && isBlank(out[field])) delete out[field];
	}
	if ('tags' in out) {
		const tags = cleanTags(out['tags']);
		if (tags.length === 0) delete out['tags'];
		else out['tags'] = tags;
	}
	if ('accept' in out) {
		const accept = Array.isArray(out['accept'])
			? out['accept'].filter(
					(entry): entry is string => typeof entry === 'string' && /\S/.test(entry)
				)
			: [];
		if (accept.length === 0) delete out['accept'];
		else out['accept'] = accept;
	}
	return out as DeckCardDto;
}

// The deck the way a save needs it: title trimmed, an empty description or tag list left out, every card tidied.
export function tidyDeck(doc: DeckDocumentDto): DeckDocumentDto {
	const deck: DeckDocumentDto['deck'] = { id: doc.deck.id, title: doc.deck.title.trim() };
	if (typeof doc.deck.description === 'string' && /\S/.test(doc.deck.description)) {
		deck.description = doc.deck.description;
	}
	const tags = cleanTags(doc.deck.tags);
	if (tags.length > 0) deck.tags = tags;
	return { tessera: doc.tessera, deck, cards: doc.cards.map(tidyCard) };
}

function tooLong(field: string, value: string, max: number): EditProblem | undefined {
	return value.length > max
		? { field, message: `${field} is too long (maximum ${max} characters)` }
		: undefined;
}

function textProblems(card: DeckCardDto, field: string): EditProblem[] {
	const value = card[field];
	if (isBlank(value)) return [{ field, message: `${field} must not be blank` }];
	const long = tooLong(field, value as string, LIMITS.maxTextLength);
	return long ? [long] : [];
}

function tagProblems(tags: unknown, field = 'tags'): EditProblem[] {
	if (!Array.isArray(tags)) return [];
	const problems: EditProblem[] = [];
	if (tags.length > LIMITS.maxTags) {
		problems.push({ field, message: `too many tags (maximum ${LIMITS.maxTags})` });
	}
	for (const tag of tags) {
		if (typeof tag !== 'string') continue;
		if (tag.length > LIMITS.maxTagLength) {
			problems.push({
				field,
				message: `a tag is too long (maximum ${LIMITS.maxTagLength} characters)`
			});
		} else if (!TAG_PATTERN.test(tag)) {
			problems.push({ field, message: `a tag ${TAG_MESSAGE}` });
		}
	}
	return problems;
}

function choiceProblems(card: DeckCardDto): EditProblem[] {
	const problems = textProblems(card, 'front');
	const choices = Array.isArray(card['choices']) ? (card['choices'] as unknown[]) : [];
	if (choices.length < LIMITS.minChoices) {
		problems.push({
			field: 'choices',
			message: `choices needs at least ${LIMITS.minChoices} items`
		});
	}
	if (choices.length > LIMITS.maxChoices) {
		problems.push({
			field: 'choices',
			message: `choices allows at most ${LIMITS.maxChoices} items`
		});
	}
	const firstUse = new Map<string, number>();
	choices.forEach((choice, index) => {
		const field = `choices[${index}]`;
		if (isBlank(choice)) {
			problems.push({ field, message: 'a choice must not be empty' });
			return;
		}
		const text = choice as string;
		if (text.length > LIMITS.maxChoiceLength) {
			problems.push({
				field,
				message: `a choice is too long (maximum ${LIMITS.maxChoiceLength} characters)`
			});
		}
		const key = text.trim().toLowerCase();
		const first = firstUse.get(key);
		if (first === undefined) firstUse.set(key, index);
		else problems.push({ field, message: `choice ${index + 1} repeats choice ${first + 1}` });
	});
	const correct = card['correct'];
	if (
		typeof correct !== 'number' ||
		!Number.isInteger(correct) ||
		correct < 0 ||
		correct >= choices.length
	) {
		problems.push({ field: 'correct', message: 'pick which choice is the correct one' });
	}
	return problems;
}

// What is wrong with a card, as the deck format sees it, in the order a person fills the card in. Empty when the
// card is fine. A card that passes here is accepted by the server's checks; the reverse is not promised, so the
// server's answer still wins.
export function cardProblems(input: DeckCardDto): EditProblem[] {
	const card = tidyCard(input);
	const problems: EditProblem[] = [];

	switch (card.type) {
		case 'basic':
			problems.push(...textProblems(card, 'front'), ...textProblems(card, 'back'));
			break;
		case 'cloze': {
			const text = textProblems(card, 'text');
			problems.push(...text);
			if (text.length === 0) {
				const value = card['text'] as string;
				if (!CLOZE_MARKER_PATTERN.test(value)) {
					problems.push({
						field: 'text',
						message: 'text needs at least one cloze marker such as {{c1::answer}}'
					});
				}
				for (const issue of validateCloze(value)) {
					problems.push({ field: 'text', message: issue.message });
				}
			}
			break;
		}
		case 'typed': {
			problems.push(...textProblems(card, 'front'), ...textProblems(card, 'answer'));
			const accept = Array.isArray(card['accept']) ? (card['accept'] as string[]) : [];
			if (accept.length > LIMITS.maxAccept) {
				problems.push({
					field: 'accept',
					message: `too many accepted answers (maximum ${LIMITS.maxAccept})`
				});
			}
			if (accept.some((entry) => entry.length > LIMITS.maxAcceptLength)) {
				problems.push({
					field: 'accept',
					message: `an accepted answer is too long (maximum ${LIMITS.maxAcceptLength} characters)`
				});
			}
			break;
		}
		case 'choice':
			problems.push(...choiceProblems(card));
			break;
		default:
			problems.push({ field: 'type', message: 'pick a card type' });
	}

	for (const field of ['hint', 'extra', 'explanation'] as const) {
		const value = card[field];
		if (typeof value === 'string') {
			const long = tooLong(field, value, LIMITS.maxTextLength);
			if (long) problems.push(long);
		}
	}
	const source = card['source'];
	if (typeof source === 'string') {
		const long = tooLong('source', source, LIMITS.maxSourceLength);
		if (long) problems.push(long);
	}
	problems.push(...tagProblems(card['tags']));
	return problems;
}

// What is wrong with the deck as a whole: its title, description, tags, and how many cards it has. The cards
// themselves are checked one by one with cardProblems.
export function deckProblems(doc: DeckDocumentDto): EditProblem[] {
	const problems: EditProblem[] = [];
	const title = doc.deck.title;
	if (!/\S/.test(title)) problems.push({ field: 'title', message: 'title must not be blank' });
	else if (title.trim().length > LIMITS.maxTitleLength) {
		problems.push({
			field: 'title',
			message: `title is too long (maximum ${LIMITS.maxTitleLength} characters)`
		});
	}
	const description = doc.deck.description;
	if (typeof description === 'string' && description.length > LIMITS.maxDescriptionLength) {
		problems.push({
			field: 'description',
			message: `description is too long (maximum ${LIMITS.maxDescriptionLength} characters)`
		});
	}
	problems.push(...tagProblems(cleanTags(doc.deck.tags)));
	if (doc.cards.length === 0) {
		problems.push({
			field: 'cards',
			message:
				'A deck needs at least one card. Add a card, or put the deck in the Trash if you are done with it.'
		});
	} else if (doc.cards.length > LIMITS.maxCards) {
		problems.push({
			field: 'cards',
			message: `cards allows at most ${LIMITS.maxCards} items`
		});
	}
	return problems;
}

export interface ChangeSummary {
	changed: number;
	added: number;
	removed: number;
	detailsChanged: boolean;
	any: boolean;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => compareText(a, b));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

// Tag order is not a change a person made, so it is left out of the comparison.
const withSortedTags = (value: Record<string, unknown>): Record<string, unknown> =>
	Array.isArray(value['tags'])
		? { ...value, tags: [...(value['tags'] as string[])].sort() }
		: value;

const withoutId = (deck: DeckDocumentDto['deck']): Record<string, unknown> =>
	Object.fromEntries(Object.entries(deck).filter(([key]) => key !== 'id'));

// A count of what the person changed, from the deck as loaded and the deck as it stands in the editor. A
// quick local count for the Save button; the server's preview is the exact one.
export function changeSummary(original: DeckDocumentDto, draft: DeckDocumentDto): ChangeSummary {
	const before = tidyDeck(original);
	const after = tidyDeck(draft);

	const keyed = (cards: DeckCardDto[]) =>
		new Map(
			cards.map((card, index) => [
				typeof card.id === 'string' ? card.id : `#${index}`,
				canonical(withSortedTags(card))
			])
		);
	const was = keyed(before.cards);
	const now = keyed(after.cards);

	let changed = 0;
	let added = 0;
	let removed = 0;
	for (const [key, form] of now) {
		const earlier = was.get(key);
		if (earlier === undefined) added++;
		else if (earlier !== form) changed++;
	}
	for (const key of was.keys()) if (!now.has(key)) removed++;

	const deckBefore = withoutId(before.deck);
	const deckAfter = withoutId(after.deck);
	const detailsChanged =
		canonical(withSortedTags(deckBefore)) !== canonical(withSortedTags(deckAfter));
	return {
		changed,
		added,
		removed,
		detailsChanged,
		any: changed + added + removed > 0 || detailsChanged
	};
}

const PREVIEW_LENGTH = 100;

function clozeLine(nodes: readonly ClozeNode[]): string {
	return nodes
		.map((node) => (node.kind === 'text' ? node.text : `[${clozeLine(node.children)}]`))
		.join('');
}

function questionText(card: DeckCardDto): string {
	if (card.type === 'cloze') {
		return typeof card['text'] === 'string' ? clozeLine(parseCloze(card['text']).nodes) : '';
	}
	return typeof card['front'] === 'string' ? card['front'] : '';
}

// One line for a card in a list: its question, on one line, at most a hundred characters. A cloze shows each
// blank as [answer].
export function cardPreviewText(card: DeckCardDto): string {
	const line = questionText(card).replace(/\s+/g, ' ').trim();
	if (line === '') return '(empty)';
	return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : line;
}
