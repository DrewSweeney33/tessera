import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	parseJson,
	parseMarkdown,
	serializeJson,
	serializeMarkdown
} from '#lib/core/parse/index.ts';
import { LABEL_NAMES } from '#lib/core/parse/markdown-syntax.ts';
import { LIMITS } from '#lib/core/schema/index.ts';
import { canonicalJson, normalizeCard } from '#lib/core/schema/normalize.ts';
import type { Deck } from '#lib/core/schema/index.ts';
import { HIGHLIGHT_LANGUAGES, LANGUAGE_ALIASES, languageFor } from '#lib/ui/code-blocks.ts';

// The example decks, the format reference, the Claude workflow guide, and the Claude skill all describe the same
// format as the code. These tests keep them from drifting: every deck is parsed by the real parser, and every
// number, name, and message the documents state is compared with the code that produces it.

const read = (path: string) => readFileSync(path, 'utf8');

function parse(text: string, kind: 'json' | 'markdown', label: string): Deck {
	const result = kind === 'json' ? parseJson(text) : parseMarkdown(text);
	if (!result.ok) throw new Error(`${label}: ${JSON.stringify(result.error, null, 2)}`);
	return result.value;
}

// A deck as data that is the same whichever format it came from.
function canonical(deck: Deck): string {
	return canonicalJson({ deck: deck.deck, cards: deck.cards.map((card) => normalizeCard(card)) });
}

// Fenced blocks whose info string has "tessera-deck": complete decks that must import.
function deckBlocks(text: string): { kind: 'json' | 'markdown'; body: string; index: number }[] {
	const found: { kind: 'json' | 'markdown'; body: string; index: number }[] = [];
	const pattern = /^```(json|markdown)[ \t]+tessera-deck[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm;
	for (const match of text.matchAll(pattern)) {
		found.push({
			kind: match[1] as 'json' | 'markdown',
			body: match[2]!,
			index: found.length + 1
		});
	}
	return found;
}

// ---- The example decks

const exampleFiles = readdirSync('examples').filter((f) => /\.(json|md)$/.test(f));
const examples = exampleFiles.map((file) => {
	const text = read(join('examples', file));
	const kind = file.endsWith('.json') ? ('json' as const) : ('markdown' as const);
	return { file, text, kind, deck: parse(text, kind, file) };
});

describe('the example decks', () => {
	it('are three decks, one of them in both formats', () => {
		expect(exampleFiles.sort()).toEqual([
			'ccna-ospf.json',
			'ccna-ospf.md',
			'powershell-essentials.md',
			'tcp-ip-fundamentals.json'
		]);
	});

	it.each(exampleFiles)('%s imports cleanly and every card has a stable id', (file) => {
		const { deck } = examples.find((e) => e.file === file)!;
		expect(deck.cards.length).toBeGreaterThanOrEqual(10);
		for (const [index, card] of deck.cards.entries()) {
			expect(card.id, `${file} card ${index}`).toMatch(/^[a-z0-9][a-z0-9-]*$/);
		}
		expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);
		expect(deck.deck.description?.length ?? 0).toBeGreaterThan(10);
		expect(deck.deck.tags?.length ?? 0).toBeGreaterThan(0);
	});

	it('the two formats of the CCNA deck are the same deck', () => {
		const json = examples.find((e) => e.file === 'ccna-ospf.json')!;
		const markdown = examples.find((e) => e.file === 'ccna-ospf.md')!;
		expect(canonical(markdown.deck)).toBe(canonical(json.deck));
	});

	it('the Markdown file is what the writer produces, so it is never out of date', () => {
		const json = examples.find((e) => e.file === 'ccna-ospf.json')!;
		const written = serializeMarkdown(json.deck);
		expect(written.ok && written.value).toBe(examples.find((e) => e.file === 'ccna-ospf.md')!.text);
	});

	it.each(exampleFiles)('%s survives a trip through the other format', (file) => {
		const { deck } = examples.find((e) => e.file === file)!;
		const asMarkdown = serializeMarkdown(deck);
		expect(asMarkdown.ok, JSON.stringify(!asMarkdown.ok && asMarkdown.error)).toBe(true);
		if (asMarkdown.ok) {
			expect(canonical(parse(asMarkdown.value, 'markdown', file))).toBe(canonical(deck));
		}
		expect(canonical(parse(serializeJson(deck), 'json', file))).toBe(canonical(deck));
	});

	it('use every card type, several blanks in one cloze card, code, a table, and a diagram', () => {
		const cards = examples.flatMap((e) => e.deck.cards);
		for (const type of ['basic', 'cloze', 'typed', 'choice']) {
			expect(
				cards.some((c) => c.type === type),
				type
			).toBe(true);
		}
		const texts = cards.map((c) => JSON.stringify(c));
		expect(cards.some((c) => c.type === 'cloze' && /\{\{c3::/.test(c.text))).toBe(true);
		expect(cards.some((c) => c.type === 'typed' && (c.accept?.length ?? 0) > 0)).toBe(true);
		expect(cards.some((c) => c.type === 'choice' && c.explanation)).toBe(true);
		expect(texts.some((t) => t.includes('```mermaid'))).toBe(true);
		expect(texts.some((t) => t.includes('```powershell'))).toBe(true);
		expect(texts.some((t) => t.includes('|---|'))).toBe(true);
	});

	it('only name code languages that the highlighter knows, and keep every diagram small enough to draw', () => {
		for (const { file, deck } of examples) {
			for (const card of deck.cards) {
				for (const field of JSON.stringify(card).matchAll(
					/```([A-Za-z0-9+#-]+)\\n([\s\S]*?)```/g
				)) {
					const [, lang, body] = field;
					if (lang === 'mermaid') {
						expect(body!.length, `${file} ${card.id}`).toBeLessThan(2000);
					} else {
						expect(languageFor(lang!), `${file} ${card.id}: ${lang}`).toBeDefined();
					}
				}
			}
		}
	});

	it('import the same when wrapped in a code block, with Windows line endings, and with a byte order mark', () => {
		const original = examples.find((e) => e.file === 'powershell-essentials.md')!;
		const wrapped = '````markdown\n' + original.text + '````\n';
		expect(canonical(parse(wrapped, 'markdown', 'wrapped'))).toBe(canonical(original.deck));
		const windows = '﻿' + original.text.replaceAll('\n', '\r\n');
		expect(canonical(parse(windows, 'markdown', 'windows'))).toBe(canonical(original.deck));
		const tilde = '~~~~\n' + original.text + '~~~~\n';
		expect(canonical(parse(tilde, 'markdown', 'tilde'))).toBe(canonical(original.deck));
	});

	it('import the same when a chat wrapped the JSON in a code block', () => {
		const original = examples.find((e) => e.file === 'tcp-ip-fundamentals.json')!;
		const wrapped = '```json\n' + original.text + '```\n';
		expect(canonical(parse(wrapped, 'json', 'wrapped'))).toBe(canonical(original.deck));
	});
});

// ---- The documents

const documents = {
	'docs/deck-format.md': read('docs/deck-format.md'),
	'docs/claude-workflow.md': read('docs/claude-workflow.md'),
	'claude-skill/tessera-deck/SKILL.md': read('claude-skill/tessera-deck/SKILL.md')
} as const;
const reference = documents['docs/deck-format.md'];
const skill = documents['claude-skill/tessera-deck/SKILL.md'];

describe('the complete decks shown in the documents', () => {
	for (const [name, text] of Object.entries(documents)) {
		for (const block of deckBlocks(text)) {
			it(`${name}, ${block.kind} example ${block.index} imports and gives every card an id`, () => {
				const deck = parse(block.body, block.kind, name);
				expect(deck.cards.length).toBeGreaterThanOrEqual(4);
				for (const card of deck.cards) expect(card.id).toBeDefined();
			});
		}
	}

	it('the reference and the skill each show the same deck in Markdown and in JSON', () => {
		for (const [name, text] of [
			['reference', reference],
			['skill', skill]
		] as const) {
			const blocks = deckBlocks(text);
			expect(
				blocks.map((b) => b.kind),
				name
			).toEqual(['markdown', 'json']);
			const markdown = parse(blocks[0]!.body, 'markdown', name);
			const json = parse(blocks[1]!.body, 'json', name);
			if (name === 'reference') {
				expect(canonical(markdown)).toBe(canonical(json));
			} else {
				// The skill's JSON example is shorter on purpose, but every card in it must exist in the Markdown one.
				const ids = new Set(markdown.cards.map((c) => c.id));
				for (const card of json.cards) expect(ids.has(card.id), card.id).toBe(true);
			}
		}
	});

	it('the reference has the example decks it points to', () => {
		for (const file of exampleFiles) expect(reference).toContain(file.replace(/\.(json|md)$/, ''));
	});
});

describe('what the documents say about the code', () => {
	const listAfter = (text: string, marker: RegExp): string[] =>
		(marker.exec(text)?.[1] ?? '')
			.split(',')
			.map((item) => item.trim().replace(/\.$/, ''))
			.filter(Boolean);

	it('lists exactly the languages that are highlighted', () => {
		const inReference = listAfter(reference, /Highlighted languages: ([^\n]+)/);
		const inSkill = listAfter(skill, /Highlighted languages: ([^(\n]+)\(/);
		expect(inReference.sort()).toEqual([...HIGHLIGHT_LANGUAGES].sort());
		expect(inSkill.sort()).toEqual([...HIGHLIGHT_LANGUAGES].sort());
	});

	it('lists exactly the short names that work', () => {
		const names = listAfter(reference, /Short names also work: ([^\n]+)/);
		expect(names.sort()).toEqual(Object.keys(LANGUAGE_ALIASES).sort());
		for (const name of names) expect(languageFor(name), name).toBeDefined();
	});

	it('has a row for every field label, and no label the parser does not have', () => {
		const labels = [...reference.matchAll(/^\| `([A-Z][a-z]*:)`/gm)].map((m) =>
			m[1]!.toLowerCase()
		);
		expect(labels.sort()).toEqual(LABEL_NAMES.map((l) => `${l}:`).sort());
		for (const label of LABEL_NAMES) {
			const shown = `${label[0]!.toUpperCase()}${label.slice(1)}:`;
			expect(skill, label).toContain(shown);
		}
	});

	it('states the limits of the schema', () => {
		const n = (value: number) => value.toLocaleString('en-US');
		const rows: Record<string, string> = {
			'File size': `${LIMITS.maxBodyBytes / (1024 * 1024)} MB`,
			'Cards in one deck file': n(LIMITS.maxCards),
			'Characters in one text field': n(LIMITS.maxTextLength),
			'Characters in the deck title': n(LIMITS.maxTitleLength),
			'Characters in the deck description': n(LIMITS.maxDescriptionLength),
			'Characters in a source': n(LIMITS.maxSourceLength),
			'Tags on a card': n(LIMITS.maxTags),
			'Characters in a tag': n(LIMITS.maxTagLength),
			'Choices on a card': `${LIMITS.minChoices} to ${LIMITS.maxChoices}`,
			'Characters in one choice': n(LIMITS.maxChoiceLength),
			'Accepted answers on a typed card': n(LIMITS.maxAccept),
			'Characters in one accepted answer': n(LIMITS.maxAcceptLength),
			'Characters in an id': n(LIMITS.maxIdLength)
		};
		const table = new Map(
			[...reference.matchAll(/^\| ([^|\n]+?)\s*\| ([^|\n]+?)\s*\|$/gm)].map((m) => [m[1]!, m[2]!])
		);
		for (const [label, value] of Object.entries(rows)) {
			expect(table.get(label), label).toBe(value);
		}

		const sentence = skill.slice(skill.indexOf('## Limits'), skill.indexOf('## Checklist'));
		for (const value of [
			`${LIMITS.maxBodyBytes / (1024 * 1024)} MB`,
			n(LIMITS.maxCards),
			n(LIMITS.maxTextLength),
			n(LIMITS.maxTitleLength),
			n(LIMITS.maxDescriptionLength),
			n(LIMITS.maxSourceLength),
			`${LIMITS.maxTags} tags of ${LIMITS.maxTagLength}`,
			`${LIMITS.minChoices} to ${LIMITS.maxChoices}`,
			n(LIMITS.maxChoiceLength),
			`${LIMITS.maxAccept} accepted answers of ${LIMITS.maxAcceptLength}`,
			`${LIMITS.maxIdLength} characters`
		]) {
			expect(sentence, value).toContain(value);
		}
	});

	it('quotes error messages that the parser really gives', () => {
		const head = '---\ntessera: 1\nid: demo\ntitle: Demo\n---\n\n';
		const messages = [
			parseMarkdown(head + '## a\nQ: What is TCP?\n'),
			parseMarkdown(head + '## a\nQ: q\nChoices:\n- one\n- two\n'),
			parseMarkdown(head + '## a\nCloze: The {{c1::DR is elected\n'),
			parseMarkdown(head + '## My Card\nQ: q\nA: a\n'),
			parseJson(
				'{"tessera":1,"deck":{"id":"demo","title":"Demo"},"cards":[{"id":"a","type":"basic","front":"q"},{"id":"b","type":"basic","front":"q","back":"b"},{"type":"choice","front":"q","choices":["a","b"],"correct":2}]}'
			)
		].flatMap((result) => (result.ok ? [] : result.error));
		expect(messages.length).toBe(6);
		for (const error of messages) expect(reference, error.code).toContain(error.message);
	});

	it('names only error codes that exist in the code', () => {
		const sources = ['markdown.ts', 'json.ts'].map((f) => read(join('src/lib/core/parse', f)));
		sources.push(read('src/lib/core/cloze.ts'), read('src/lib/core/schema/errors.ts'));
		const source = sources.join('\n');
		const section = skill.slice(
			skill.indexOf('## Fixing import errors'),
			skill.indexOf('## Limits')
		);
		const codes = [...section.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!);
		expect(codes.length).toBeGreaterThan(10);
		for (const code of new Set(codes)) {
			expect(source.includes(`'${code}'`) || source.includes(`"${code}"`), code).toBe(true);
		}
		// And every error the reference shows has its code in the code too.
		for (const code of [
			'cannot_infer_type',
			'no_correct_choice',
			'unclosed_cloze',
			'invalid_format',
			'required',
			'out_of_range'
		]) {
			expect(reference).toContain(`[${code}]`);
		}
	});
});

describe('links and pointers', () => {
	it.each(Object.keys(documents))(
		'every relative link in %s points at a file that exists',
		(name) => {
			const text = documents[name as keyof typeof documents];
			const broken: string[] = [];
			for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
				const target = match[1]!.split('#')[0]!;
				if (!existsSync(resolve(dirname(name), target))) broken.push(target);
			}
			expect(broken).toEqual([]);
		}
	);

	it('the skill is a valid skill: a name that matches its folder, and a description', () => {
		const front = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(skill);
		expect(front?.[1]).toBe('tessera-deck');
		expect(front?.[2]!.length).toBeGreaterThan(60);
		expect(front?.[2]!.length).toBeLessThan(1024);
		expect(existsSync('claude-skill/tessera-deck/SKILL.md')).toBe(true);
	});

	it('the skill names the formats, the labels, the id rule, and the revision rule', () => {
		for (const phrase of [
			'tessera: 1',
			'four backticks',
			'keep every existing id',
			'My Tessera deck failed to import',
			'zero-based',
			'Exactly one'
		]) {
			expect(skill.toLowerCase(), phrase).toContain(phrase.toLowerCase());
		}
	});

	it('every relative link in the README points at a file that exists', () => {
		const broken: string[] = [];
		for (const match of read('README.md').matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
			const target = match[1]!.split('#')[0]!;
			if (target && !existsSync(target)) broken.push(target);
		}
		expect(broken).toEqual([]);
	});

	it('the README points at the guides and the skill', () => {
		const readme = read('README.md');
		for (const target of [
			'docs/deck-format.md',
			'docs/claude-workflow.md',
			'claude-skill/tessera-deck'
		]) {
			expect(readme, target).toContain(target);
		}
	});
});
