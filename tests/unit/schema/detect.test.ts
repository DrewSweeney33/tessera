import { describe, expect, it } from 'vitest';
import {
	CONTENT_TYPES,
	detectFormat,
	parseJson,
	parseMarkdown,
	serializeJson,
	serializeMarkdown
} from '#lib/core/parse/index.ts';
import type { Deck } from '#lib/core/schema/index.ts';

const BOM = String.fromCharCode(0xfeff);
const MARKDOWN = '---\ntessera: 1\nid: d\ntitle: D\n---\n\n## c1\nQ: a\nA: b\n';
const JSON_DECK = '{"tessera":1,"deck":{"id":"d","title":"D"},"cards":[]}';

describe('detectFormat: the text decides', () => {
	it('reads a deck that starts with { or [ as JSON', () => {
		expect(detectFormat(JSON_DECK)).toBe('json');
		expect(detectFormat(`\n\n  ${JSON_DECK}`)).toBe('json');
		expect(detectFormat('[1]')).toBe('json');
	});

	it('reads a deck that starts with --- as Markdown', () => {
		expect(detectFormat(MARKDOWN)).toBe('markdown');
		expect(detectFormat(`\n\n${MARKDOWN}`)).toBe('markdown');
		expect(detectFormat(MARKDOWN.replaceAll('\n', '\r\n'))).toBe('markdown');
	});

	it('reads a deck that starts with --- as Markdown even before its tessera line is reached', () => {
		expect(detectFormat('---\nid: d\ntitle: D\n---\n')).toBe('markdown');
		expect(detectFormat('```\n---\nid: d\n---\n')).toBe('markdown');
	});

	it('ignores a byte order mark', () => {
		expect(detectFormat(BOM + MARKDOWN)).toBe('markdown');
		expect(detectFormat(BOM + JSON_DECK)).toBe('json');
	});

	it('looks inside one wrapping code fence, as a chat paste has', () => {
		expect(detectFormat(`\`\`\`json\n${JSON_DECK}\n\`\`\``)).toBe('json');
		expect(detectFormat(`\`\`\`markdown\n${MARKDOWN}\`\`\``)).toBe('markdown');
		expect(detectFormat(`~~~\n${MARKDOWN}~~~`)).toBe('markdown');
	});

	it('finds the deck marker when an introduction comes first', () => {
		expect(detectFormat(`Here is your deck:\n\n${MARKDOWN}`)).toBe('markdown');
		expect(detectFormat(`Here is your deck:\n\n${JSON_DECK}`)).toBe('json');
	});

	it('lets the text win over the file name', () => {
		expect(detectFormat(MARKDOWN, 'deck.json')).toBe('markdown');
		expect(detectFormat(JSON_DECK, 'deck.md')).toBe('json');
	});

	it('uses the file name only when the text does not say', () => {
		expect(detectFormat('some words', 'deck.md')).toBe('markdown');
		expect(detectFormat('some words', 'DECK.MARKDOWN')).toBe('markdown');
		expect(detectFormat('some words', 'deck.json')).toBe('json');
		expect(detectFormat('some words', 'deck.txt')).toBe('json');
		expect(detectFormat('some words', 'notes.md.txt')).toBe('json');
		expect(detectFormat('some words')).toBe('json');
	});

	it('does not throw on empty or odd input', () => {
		expect(detectFormat('')).toBe('json');
		expect(detectFormat('   \n\n  ')).toBe('json');
		expect(detectFormat('```')).toBe('json');
		expect(detectFormat('\u0000￿')).toBe('json');
	});

	it('maps each format to a content type the server accepts', () => {
		expect(CONTENT_TYPES).toEqual({ json: 'application/json', markdown: 'text/markdown' });
	});
});

describe('detectFormat agrees with the serializers and the parsers', () => {
	const deck: Deck = {
		tessera: 1,
		deck: { id: 'd', title: 'D', tags: ['x'] },
		cards: [
			{ type: 'basic', id: 'b', front: 'Q', back: 'A' },
			{ type: 'cloze', id: 'c', text: 'The {{c1::sky}} is blue.' },
			{ type: 'typed', id: 't', front: 'Capital of France?', answer: 'Paris', accept: ['paris'] },
			{ type: 'choice', id: 'ch', front: 'Pick', choices: ['a', 'b'], correct: 1 }
		]
	};

	it('detects what each serializer writes', () => {
		expect(detectFormat(serializeJson(deck))).toBe('json');
		const markdown = serializeMarkdown(deck);
		expect(markdown.ok).toBe(true);
		if (markdown.ok) expect(detectFormat(markdown.value)).toBe('markdown');
	});

	it('gives a helpful error when a Markdown deck is read as JSON', () => {
		const result = parseJson(MARKDOWN);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error[0]?.code).toBe('not_json_is_markdown');
	});

	it('gives a helpful error when a JSON deck is read as Markdown', () => {
		const result = parseMarkdown(JSON_DECK);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error[0]?.code).toBe('not_markdown_is_json');
	});
});
