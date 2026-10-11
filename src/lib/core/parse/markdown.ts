import { parseDocument, LineCounter, isMap, isScalar } from 'yaml';
import { err, type Result } from '../result.ts';
import { validateDeck, type Deck } from '../schema/deck.ts';
import type { ImportError } from '../schema/errors.ts';
import { LIMITS } from '../schema/limits.ts';
import {
	CHOICE_ITEM,
	advanceFence,
	choiceContent,
	isEscapedSpecial,
	isIndentedLabel,
	matchHeading,
	matchLabel,
	splitList,
	unescapeLine,
	type FenceState,
	type LabelName
} from './markdown-syntax.ts';

// The Markdown deck format (spec section 6.2, ADR-002). It is read into the same plain object a JSON deck
// parses to and handed to the one validator, so both formats behave identically. This file never judges
// whether a value is acceptable. It only decides what the author wrote. Every error carries a line number.

const FENCED_WRAPPER = /^(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)[ \t]*$/;

interface FieldBlock {
	label: LabelName;
	line: number;
	lines: string[];
}

interface CardBlock {
	index: number;
	headingLine: number;
	id: string;
	fields: FieldBlock[];
}

// Where each part of the result came from, to put a line number on validation errors.
interface SourceMap {
	frontmatterStart: number;
	frontmatterKeys: Map<string, number>;
	cards: {
		heading: number;
		fields: Map<string, number>;
		choiceLines: number[];
		correctLine: number | undefined;
	}[];
}

const LABEL_TO_FIELD: Record<LabelName, string> = {
	type: 'type',
	q: 'front',
	a: 'back',
	answer: 'answer',
	accept: 'accept',
	cloze: 'text',
	choices: 'choices',
	explanation: 'explanation',
	extra: 'extra',
	hint: 'hint',
	tags: 'tags',
	source: 'source'
};

const LABEL_DISPLAY: Record<LabelName, string> = {
	type: 'Type:',
	q: 'Q:',
	a: 'A:',
	answer: 'Answer:',
	accept: 'Accept:',
	cloze: 'Cloze:',
	choices: 'Choices:',
	explanation: 'Explanation:',
	extra: 'Extra:',
	hint: 'Hint:',
	tags: 'Tags:',
	source: 'Source:'
};

function problem(path: string, code: string, message: string, line?: number): ImportError {
	return { path, code, message, ...(line === undefined ? {} : { line }) };
}

// The text of a field: leading blank lines and trailing whitespace removed, the rest exactly as written.
function valueOf(block: FieldBlock): string {
	return block.lines
		.join('\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.replace(/\s+$/, '');
}

// A deck pasted from a chat is often wrapped in one code fence. Remove it, and say how many lines went.
function unwrapFence(lines: string[]): { lines: string[]; removed: number } {
	let first = 0;
	while (first < lines.length && lines[first]!.trim() === '') first++;
	let last = lines.length - 1;
	while (last > first && lines[last]!.trim() === '') last--;
	const opener = FENCED_WRAPPER.exec(lines[first] ?? '');
	const closer = /^(`{3,}|~{3,})[ \t]*$/.exec(lines[last] ?? '');
	if (
		opener &&
		closer &&
		last > first &&
		closer[1]![0] === opener[1]![0] &&
		closer[1]!.length >= opener[1]!.length
	) {
		return { lines: lines.slice(first + 1, last), removed: first + 1 };
	}
	return { lines, removed: 0 };
}

interface Frontmatter {
	value: Record<string, unknown>;
	keyLines: Map<string, number>;
	// Index in the line array of the first line after the closing marker.
	bodyStart: number;
	startLine: number;
}

// The block between the opening and closing "---" lines at the top of the file, read as YAML.
function readFrontmatter(
	lines: readonly string[],
	offset: number,
	errors: ImportError[]
): Frontmatter | undefined {
	let open = 0;
	while (open < lines.length && lines[open]!.trim() === '') open++;
	if (open >= lines.length || lines[open]!.trimEnd() !== '---') {
		const firstText = lines.slice(open).find((l) => l.trim() !== '') ?? '';
		const looksJson = /^[{[]/.test(firstText.trim());
		errors.push(
			problem(
				'(root)',
				looksJson ? 'not_markdown_is_json' : 'missing_frontmatter',
				looksJson
					? 'This looks like a JSON deck, not Markdown. Import it as JSON.'
					: 'A Markdown deck starts with a block between two --- lines holding tessera: 1, id, and title. Add it at the top of the file.',
				open + 1 + offset
			)
		);
		return undefined;
	}
	let close = open + 1;
	while (close < lines.length && !/^(?:---|\.\.\.)[ \t]*$/.test(lines[close]!)) close++;
	if (close >= lines.length) {
		errors.push(
			problem(
				'frontmatter',
				'unclosed_frontmatter',
				'The block at the top of the file is never closed. Add a line with --- after the deck fields.',
				open + 1 + offset
			)
		);
		return undefined;
	}

	const startLine = open + 1 + offset;
	const counter = new LineCounter();
	const doc = parseDocument(lines.slice(open + 1, close).join('\n'), {
		schema: 'core',
		uniqueKeys: true,
		lineCounter: counter
	});
	// The line of a YAML position, in the original file. Line 1 of the block is the line after the marker.
	const lineOf = (position: number) => counter.linePos(position).line + startLine;
	const problems = [...doc.errors, ...doc.warnings];
	if (problems.length > 0) {
		for (const issue of problems.slice(0, 5)) {
			errors.push(
				problem(
					'frontmatter',
					'invalid_frontmatter',
					`The block at the top is not valid YAML: ${issue.message.split('\n')[0]}`,
					issue.linePos?.[0] ? issue.linePos[0].line + startLine : startLine
				)
			);
		}
		return undefined;
	}
	// Expanding aliases is the one step that throws, when a block uses more than the limit (a "billion
	// laughs" attack). That is the author's problem to fix, not a crash.
	let value: unknown;
	try {
		value = doc.toJS({ maxAliasCount: 10 });
	} catch {
		errors.push(
			problem(
				'frontmatter',
				'invalid_frontmatter',
				'The block at the top uses too many YAML aliases (* references). Write the values out in full.',
				startLine
			)
		);
		return undefined;
	}
	if (value === null || value === undefined) {
		return { value: {}, keyLines: new Map(), bodyStart: close + 1, startLine };
	}
	if (typeof value !== 'object' || Array.isArray(value) || !isMap(doc.contents)) {
		errors.push(
			problem(
				'frontmatter',
				'invalid_frontmatter',
				'The block at the top must be a list of fields such as tessera: 1, id: my-deck, and title: My deck.',
				startLine
			)
		);
		return undefined;
	}
	const keyLines = new Map<string, number>();
	for (const pair of doc.contents.items) {
		if (isScalar(pair.key) && pair.key.range) {
			keyLines.set(String(pair.key.value), lineOf(pair.key.range[0]));
		}
	}
	return { value: value as Record<string, unknown>, keyLines, bodyStart: close + 1, startLine };
}

// Cuts the file into cards and their labelled fields. Anything outside a card or a field is an error,
// because silently dropping text could lose a card.
function scanCards(
	lines: readonly string[],
	start: number,
	offset: number,
	errors: ImportError[]
): CardBlock[] {
	const cards: CardBlock[] = [];
	let fence: FenceState | undefined;
	let fenceLine = 0;
	let strayReported = 0;

	const current = () => cards[cards.length - 1];
	const stray = (code: string, message: string, line: number) => {
		if (strayReported++ < 3)
			errors.push(problem(`cards[${Math.max(0, cards.length - 1)}]`, code, message, line));
	};

	for (let n = start; n < lines.length; n++) {
		const line = lines[n]!;
		const lineNo = n + 1 + offset;
		const card = current();
		const field = card?.fields[card.fields.length - 1];

		if (fence) {
			field?.lines.push(line);
			fence = advanceFence(fence, field?.label === 'choices' ? choiceContent(line) : line);
			continue;
		}

		const heading = matchHeading(line);
		if (heading) {
			cards.push({ index: cards.length, headingLine: lineNo, id: heading.id, fields: [] });
			continue;
		}

		const label = matchLabel(line);
		if (label) {
			if (!card) {
				stray(
					'field_outside_card',
					`${LABEL_DISPLAY[label.label]} appears before any card. Start each card with a heading line such as "## my-card-id".`,
					lineNo
				);
				continue;
			}
			const block: FieldBlock = { label: label.label, line: lineNo, lines: [label.rest] };
			card.fields.push(block);
			const state = advanceFence(undefined, label.rest);
			if (state) {
				fence = state;
				fenceLine = lineNo;
			}
			continue;
		}

		// An escaped label or heading is ordinary text with one backslash removed.
		const text = isEscapedSpecial(line) ? unescapeLine(line) : line;

		if (!card) {
			// Between the front matter and the first card only blank lines, a title heading, and comments.
			if (text.trim() === '' || /^#(?!#)[ \t]/.test(text) || /^<!--.*-->\s*$/.test(text)) continue;
			stray(
				'text_before_first_card',
				'This text is before the first card and would be ignored. Start a card with a heading line such as "## my-card-id", or remove the text.',
				lineNo
			);
			continue;
		}
		if (!field) {
			if (text.trim() === '') continue;
			stray(
				'text_outside_field',
				`This text is under the card heading but not in a field. Start it with a label such as Q:, A:, or Cloze:.`,
				lineNo
			);
			continue;
		}

		field.lines.push(text);
		const state = advanceFence(undefined, field.label === 'choices' ? choiceContent(text) : text);
		if (state) {
			fence = state;
			fenceLine = lineNo;
		}
	}

	if (fence) {
		errors.push(
			problem(
				`cards[${Math.max(0, cards.length - 1)}]`,
				'unclosed_fence',
				'A code block opened here is never closed, so everything after it is read as code. Add a closing ``` line.',
				fenceLine
			)
		);
	}
	return cards;
}

interface BuiltCard {
	raw: Record<string, unknown>;
	map: SourceMap['cards'][number];
}

// The list under "Choices:". Each item is "- text", with "- [x] text" marking the right one. An indented
// line continues the item above it.
function readChoices(
	block: FieldBlock,
	cardIndex: number,
	errors: ImportError[]
): {
	choices: string[];
	correct: number | undefined;
	lines: number[];
	correctLine: number | undefined;
} {
	const choices: string[] = [];
	const lines: number[] = [];
	const marked: number[] = [];
	const markedLines: number[] = [];
	const rows = block.lines;

	rows.forEach((row, offset) => {
		const lineNo = block.line + offset;
		if (offset === 0 && row.trim() === '') return;
		if (row.trim() === '') return;
		const item = CHOICE_ITEM.exec(row);
		if (item) {
			if (item[1] === 'x' || item[1] === 'X') {
				marked.push(choices.length);
				markedLines.push(lineNo);
			}
			choices.push(item[2]!);
			lines.push(lineNo);
			return;
		}
		if (/^(?: {2}|\t)/.test(row) && choices.length > 0) {
			// Whitespace inside a choice is kept. Only the end of the whole choice is trimmed, below.
			const content = row.replace(/^(?: {1,2}|\t)/, '');
			if (isIndentedLabel(content)) {
				errors.push(
					problem(
						`cards[${cardIndex}].choices`,
						'label_in_choice',
						`This line looks like a field label (${content.slice(0, content.indexOf(':') + 1)}) but it is indented, so it would be read as part of the choice above. Start it at the beginning of the line, with no indent, or put a backslash in front of it if it really is part of the choice.`,
						lineNo
					)
				);
				return;
			}
			choices[choices.length - 1] +=
				`\n${isEscapedSpecial(content) ? unescapeLine(content) : content}`;
			return;
		}
		errors.push(
			problem(
				`cards[${cardIndex}].choices`,
				'invalid_choice_line',
				`This line is not a choice. Each choice is a list item such as "- Type 1", and "- [x] Type 2" marks the right one.`,
				lineNo
			)
		);
	});

	for (let i = 0; i < choices.length; i++) choices[i] = choices[i]!.trimEnd();

	if (choices.length > 0 && marked.length === 0) {
		errors.push(
			problem(
				`cards[${cardIndex}].correct`,
				'no_correct_choice',
				'No choice is marked as the right one. Put [x] after the dash on exactly one choice, as in "- [x] Type 2".',
				block.line
			)
		);
	} else if (marked.length > 1) {
		errors.push(
			problem(
				`cards[${cardIndex}].correct`,
				'multiple_correct_choices',
				`${marked.length} choices are marked [x] (lines ${markedLines.join(', ')}). A choice card has exactly one right answer.`,
				markedLines[1]
			)
		);
	}
	return {
		choices,
		correct: marked.length === 1 ? marked[0] : undefined,
		lines,
		correctLine: markedLines[0]
	};
}

// What the card is, from its labels, unless a Type: line says. Q: with Choices: is a choice card, with
// Answer: a typed card, with A: a basic card.
function inferType(
	card: CardBlock,
	labels: ReadonlySet<LabelName>,
	errors: ImportError[]
): string | undefined {
	if (labels.has('cloze')) return 'cloze';
	if (labels.has('q')) {
		const kinds = (['choices', 'answer', 'a'] as const).filter((label) => labels.has(label));
		if (kinds.length === 1)
			return kinds[0] === 'choices' ? 'choice' : kinds[0] === 'answer' ? 'typed' : 'basic';
		errors.push(
			problem(
				`cards[${card.index}]`,
				kinds.length === 0 ? 'cannot_infer_type' : 'ambiguous_card_type',
				kinds.length === 0
					? 'This card has a Q: but no answer, so its type cannot be worked out. Add A: for a basic card, Answer: for a typed card, or Choices: for a choice card.'
					: `This card has ${kinds.map((k) => LABEL_DISPLAY[k]).join(' and ')} together, so its type is unclear. Use A: for a basic card, Answer: for a typed card, or Choices: for a choice card, not several.`,
				card.fields.find((f) => f.label === 'q')?.line ?? card.headingLine
			)
		);
		return undefined;
	}
	errors.push(
		problem(
			`cards[${card.index}]`,
			card.fields.length === 0 ? 'empty_card' : 'cannot_infer_type',
			card.fields.length === 0
				? 'This card has a heading but no content. Add Q: and A:, or Cloze:.'
				: 'This card has no Q: and no Cloze:, so its type cannot be worked out.',
			card.headingLine
		)
	);
	return undefined;
}

function buildCard(card: CardBlock, errors: ImportError[]): BuiltCard | undefined {
	const raw: Record<string, unknown> = {};
	const map: BuiltCard['map'] = {
		heading: card.headingLine,
		fields: new Map(),
		choiceLines: [],
		correctLine: undefined
	};
	if (card.id !== '') raw['id'] = card.id;
	map.fields.set('id', card.headingLine);

	const seen = new Set<LabelName>();
	for (const block of card.fields) {
		if (seen.has(block.label) && block.label !== 'accept') {
			errors.push(
				problem(
					`cards[${card.index}]`,
					'duplicate_field',
					`${LABEL_DISPLAY[block.label]} appears twice in this card. Keep one.`,
					block.line
				)
			);
		}
		seen.add(block.label);
	}

	const explicit = card.fields.find((f) => f.label === 'type');
	const type = explicit ? valueOf(explicit).toLowerCase() : inferType(card, seen, errors);
	if (type === undefined) return undefined;
	raw['type'] = type;
	map.fields.set('type', explicit?.line ?? card.headingLine);

	let accept: string[] | undefined;
	for (const block of card.fields) {
		const key = LABEL_TO_FIELD[block.label];
		if (block.label === 'type') continue;
		const value = valueOf(block);
		if (!map.fields.has(key)) map.fields.set(key, block.line);
		switch (block.label) {
			case 'tags':
				raw[key] = splitList(value);
				break;
			case 'accept':
				accept = [...(accept ?? []), ...splitList(value)];
				raw[key] = accept;
				break;
			case 'choices': {
				const read = readChoices(block, card.index, errors);
				raw[key] = read.choices;
				if (read.correct !== undefined) raw['correct'] = read.correct;
				map.choiceLines = read.lines;
				map.correctLine = read.correctLine;
				map.fields.set('correct', read.correctLine ?? block.line);
				break;
			}
			default:
				raw[key] = value;
		}
	}
	return { raw, map };
}

// The line a validation error belongs to, from its path such as "cards[3].choices[1]" or "deck.title".
function lineFor(path: string, map: SourceMap): number | undefined {
	const card = /^cards\[(\d+)\](?:\.([A-Za-z]+)(?:\[(\d+)\])?)?$/.exec(path);
	if (card) {
		const source = map.cards[Number(card[1])];
		if (!source) return undefined;
		const field = card[2];
		if (field === undefined) return source.heading;
		if (field === 'choices' && card[3] !== undefined) {
			return source.choiceLines[Number(card[3])] ?? source.fields.get('choices') ?? source.heading;
		}
		return source.fields.get(field) ?? source.heading;
	}
	const deck = /^deck(?:\.([A-Za-z]+))?/.exec(path);
	if (deck) return (deck[1] ? map.frontmatterKeys.get(deck[1]) : undefined) ?? map.frontmatterStart;
	if (path === 'tessera') return map.frontmatterKeys.get('tessera') ?? map.frontmatterStart;
	return undefined;
}

function cap(errors: ImportError[]): ImportError[] {
	const sorted = [...errors].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
	if (sorted.length <= LIMITS.maxReportedErrors) return sorted;
	const shown = sorted.slice(0, LIMITS.maxReportedErrors);
	shown.push({
		path: '(root)',
		code: 'too_many_errors',
		message: `${sorted.length - LIMITS.maxReportedErrors} more errors not shown. Fix the ones above and import again.`
	});
	return shown;
}

function readMarkdown(input: string): Result<Deck, ImportError[]> {
	if (new TextEncoder().encode(input).length > LIMITS.maxBodyBytes) {
		return err([
			problem(
				'(root)',
				'payload_too_large',
				`The deck is larger than the ${LIMITS.maxBodyBytes / (1024 * 1024)} MB limit. Split it into several smaller decks.`
			)
		]);
	}
	if (input.trim() === '') {
		return err([
			problem('(root)', 'empty', 'The input is empty. Paste a deck in the Tessera Markdown format.')
		]);
	}

	const content = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const unwrapped = unwrapFence(content.replace(/\r\n?/g, '\n').split('\n'));
	const lines = unwrapped.lines;
	const offset = unwrapped.removed;

	const errors: ImportError[] = [];
	const front = readFrontmatter(lines, offset, errors);
	if (!front) return err(cap(errors));

	const blocks = scanCards(lines, front.bodyStart, offset, errors);
	const built: BuiltCard[] = [];
	for (const block of blocks) {
		const card = buildCard(block, errors);
		if (card) built.push(card);
	}
	if (errors.length > 0) return err(cap(errors));

	const { tessera, ...deckFields } = front.value;
	const raw = {
		...(tessera === undefined ? {} : { tessera }),
		deck: deckFields,
		cards: built.map((card) => card.raw)
	};
	const map: SourceMap = {
		frontmatterStart: front.startLine,
		frontmatterKeys: front.keyLines,
		cards: built.map((card) => card.map)
	};

	const result = validateDeck(raw);
	if (result.ok) return result;
	return err(
		cap(
			result.error.map((error) => {
				const line = lineFor(error.path, map);
				const message =
					error.path === 'tessera' && error.code === 'required'
						? 'tessera is required: add tessera: 1 to the block at the top of the file'
						: error.message;
				return { ...error, message, ...(line === undefined ? {} : { line }) };
			})
		)
	);
}

// Reads a Markdown deck and validates it. Bad input is returned as errors and never thrown. The catch below
// is a last resort so that a bug in the reader can only ever show up as a refused import, not a crashed
// request. The tests, including random garbage, are what keep it from ever being reached.
export function parseMarkdown(input: string): Result<Deck, ImportError[]> {
	try {
		return readMarkdown(input);
	} catch {
		return err([
			problem(
				'(root)',
				'unreadable',
				'The deck could not be read. Check that it follows the Tessera Markdown format, or import it as JSON.'
			)
		]);
	}
}
