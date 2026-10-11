import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	parseJson,
	parseMarkdown,
	serializeJson,
	serializeMarkdown
} from '#lib/core/parse/index.ts';
import { canonicalJson, normalizeCard } from '#lib/core/schema/normalize.ts';
import { validateDeck, type Deck } from '#lib/core/schema/index.ts';

// The two formats must mean the same thing, and writing a deck out and reading it back must change nothing
// that matters. "Nothing that matters" is what a re-import already ignores: line endings, trailing space,
// accent composition, and the order of tags. Run with FC_SEED=<number> to repeat a failing run, and with
// FC_RUNS=<number> for a longer one.

const SEED = Number(process.env['FC_SEED'] ?? 20261011);
const RUNS = Number(process.env['FC_RUNS'] ?? 300);
const options = { seed: SEED, numRuns: RUNS };

// ---- Generators of text that is hard to write safely

const plain = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.!?'-]{0,18}$/);

const awkwardLines = fc.constantFrom(
	'Q: x',
	'A: y',
	'Answer: z',
	'Accept: a, b',
	'Cloze: {{c1::x}}',
	'Choices:',
	'- [x] item',
	'Tags: t',
	'Hint: h',
	'Source: s',
	'Type: basic',
	'Explanation: e',
	'Extra: e',
	'## heading',
	'##',
	'###  sub heading',
	String.raw`\Q: escaped`,
	String.raw`\\A: two slashes`,
	String.raw`\## escaped heading`,
	'---',
	'...',
	'<!-- comment -->',
	'# title',
	'    four spaces',
	'  two spaces',
	'trailing spaces   ',
	'`inline`',
	'{{c2::y}}',
	'::',
	'{',
	'}',
	'q: lower case label',
	'日本語のテキスト',
	'café',
	'e\u0301',
	'ß',
	'😀',
	'C:\\temp\\file'
);

const unicode = fc.constantFrom('naïve', '東京', 'Ωmega', '👨‍👩‍👧');

// A complete fenced block, so the text stays balanced. Whatever is inside is opaque to the format.
const balancedFence = fc
	.tuple(
		fc.constantFrom('```', '~~~', '````', '```bash', '~~~text'),
		fc.array(fc.oneof(plain, awkwardLines), { maxLength: 4 })
	)
	.map(([open, inner]) => {
		const char = open[0]!;
		const length = open.match(/^[`~]+/)![0].length;
		return [open, ...inner, char.repeat(length)].join('\n');
	});

const unbalancedFence = fc.constantFrom('```', '~~~', '````js');

const fragment = (fences: 'balanced' | 'anything') =>
	fc.oneof(
		{ weight: 60, arbitrary: plain },
		{ weight: 50, arbitrary: awkwardLines },
		{ weight: 10, arbitrary: unicode },
		{ weight: 20, arbitrary: balancedFence },
		// Rare, because one unbalanced fence anywhere in a deck makes the whole deck unwritable.
		...(fences === 'anything' ? [{ weight: 1, arbitrary: unbalancedFence }] : [])
	);

// Text with no spaces at the very start (the format drops them) and not blank.
const textOf = (fences: 'balanced' | 'anything') =>
	fc
		.array(fragment(fences), { minLength: 1, maxLength: 6 })
		.map((parts) => parts.join('\n'))
		.map((value) => (fences === 'balanced' ? value.replace(/^\s+/, '') : value))
		.filter((value) => value.trim() !== '');

const idArb = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/);
const tagArb = fc.stringMatching(/^[a-z0-9]([a-z0-9 _-]{0,8}[a-z0-9])?$/);
// Accepted answers may hold commas and backslashes, which the list syntax escapes.
const acceptArb = fc.stringMatching(/^[A-Za-z0-9]([A-Za-z0-9 ,.\\-]{0,14}[A-Za-z0-9])?$/);
const choiceArb = (fences: 'balanced' | 'anything') =>
	textOf(fences).filter(
		(value) => value.split('\n').every((line) => line.trim() !== '') || fences === 'anything'
	);

function cardArb(fences: 'balanced' | 'anything') {
	const text = textOf(fences);
	const common = {
		hint: fc.option(text, { nil: undefined }),
		tags: fc.option(fc.uniqueArray(tagArb, { maxLength: 4 }), { nil: undefined }),
		source: fc.option(text, { nil: undefined })
	};
	return fc.oneof(
		fc.record({ type: fc.constant('basic' as const), front: text, back: text, ...common }),
		fc.record({
			type: fc.constant('cloze' as const),
			text: text.map((value) => `${value}\n{{c1::answer}}`),
			extra: fc.option(text, { nil: undefined }),
			...common
		}),
		fc.record({
			type: fc.constant('typed' as const),
			front: text,
			answer: text,
			accept: fc.option(fc.uniqueArray(acceptArb, { minLength: 1, maxLength: 3 }), {
				nil: undefined
			}),
			...common
		}),
		fc
			.record({
				type: fc.constant('choice' as const),
				front: text,
				choices: fc.uniqueArray(choiceArb(fences), {
					minLength: 2,
					maxLength: 4,
					selector: (value) => value.trim().toLowerCase()
				}),
				explanation: fc.option(text, { nil: undefined }),
				...common
			})
			.chain((card) =>
				fc.nat({ max: card.choices.length - 1 }).map((correct) => ({ ...card, correct }))
			)
	);
}

function deckArb(fences: 'balanced' | 'anything') {
	return fc
		.record({
			id: idArb,
			title: fc.oneof(plain, textOf('balanced')),
			description: fc.option(textOf('balanced'), { nil: undefined }),
			tags: fc.option(fc.uniqueArray(tagArb, { maxLength: 3 }), { nil: undefined }),
			cards: fc.array(fc.tuple(cardArb(fences), fc.boolean()), { minLength: 1, maxLength: 5 })
		})
		.map((raw) => {
			const clean = <T extends Record<string, unknown>>(value: T) =>
				Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
			return {
				tessera: 1,
				deck: clean({ id: raw.id, title: raw.title, description: raw.description, tags: raw.tags }),
				cards: raw.cards.map(([card, withId], index) =>
					clean({ ...(withId ? { id: `c${index}` } : {}), ...card })
				)
			};
		});
}

// Only decks the validator accepts are interesting here.
function validDecks(fences: 'balanced' | 'anything') {
	return deckArb(fences)
		.map((raw) => validateDeck(raw))
		.filter((result): result is { ok: true; value: Deck } => result.ok)
		.map((result) => result.value);
}

// What a re-import treats as the same deck: the deck fields as written, and every card normalized.
function canon(deck: Deck): unknown {
	return {
		deck: deck.deck,
		cards: deck.cards.map((card) => canonicalJson(normalizeCard(card)))
	};
}

function mustParseJson(text: string): Deck {
	const result = parseJson(text);
	if (!result.ok) throw new Error(`JSON did not parse: ${JSON.stringify(result.error)}`);
	return result.value;
}

function mustParseMarkdown(text: string): Deck {
	const result = parseMarkdown(text);
	if (!result.ok) {
		throw new Error(`Markdown did not parse: ${JSON.stringify(result.error)}\n--- text:\n${text}`);
	}
	return result.value;
}

describe('the generators', () => {
	it('make mostly valid decks, so the properties below are not vacuous', () => {
		const samples = fc.sample(deckArb('balanced'), { seed: SEED, numRuns: 200 });
		const valid = samples.filter((raw) => validateDeck(raw).ok).length;
		expect(valid).toBeGreaterThan(180);
	});

	it('produce the awkward text they claim to', () => {
		const samples = fc.sample(textOf('balanced'), { seed: SEED, numRuns: 400 }).join('\n');
		for (const needle of ['\nQ: ', '\nAnswer: ', '\n## ', '\n---', '```', '~~~', String.raw`\Q:`]) {
			expect(samples, needle).toContain(needle);
		}
	});
});

describe('JSON', () => {
	it('round trips exactly', () => {
		fc.assert(
			fc.property(validDecks('anything'), (deck) => {
				expect(mustParseJson(serializeJson(deck))).toEqual(deck);
			}),
			options
		);
	});

	it('writes keys in a fixed order and ends with a newline', () => {
		const deck = mustParseJson(
			JSON.stringify({
				tessera: 1,
				deck: { title: 'T', id: 'd' },
				cards: [{ tags: ['x'], back: 'b', front: 'f', type: 'basic', id: 'a' }]
			})
		);
		const text = serializeJson(deck);
		expect(text.endsWith('\n')).toBe(true);
		expect(Object.keys(JSON.parse(text).cards[0])).toEqual(['id', 'type', 'front', 'back', 'tags']);
		expect(Object.keys(JSON.parse(text).deck)).toEqual(['id', 'title']);
		expect(serializeJson(deck)).toBe(text);
	});
});

describe('Markdown', () => {
	it('round trips decks full of awkward text, and every one can be written', () => {
		fc.assert(
			fc.property(validDecks('balanced'), (deck) => {
				const written = serializeMarkdown(deck);
				if (!written.ok) throw new Error(`could not write: ${JSON.stringify(written.error)}`);
				expect(canon(mustParseMarkdown(written.value))).toEqual(canon(deck));
			}),
			options
		);
	});

	it('reads the same deck from either format', () => {
		fc.assert(
			fc.property(validDecks('balanced'), (deck) => {
				const written = serializeMarkdown(deck);
				if (!written.ok) throw new Error(`could not write: ${JSON.stringify(written.error)}`);
				expect(canon(mustParseMarkdown(written.value))).toEqual(
					canon(mustParseJson(serializeJson(deck)))
				);
			}),
			options
		);
	});

	it('is stable: reading and writing again gives the same text', () => {
		fc.assert(
			fc.property(validDecks('balanced'), (deck) => {
				const first = serializeMarkdown(deck);
				if (!first.ok) throw new Error(`could not write: ${JSON.stringify(first.error)}`);
				const second = serializeMarkdown(mustParseMarkdown(first.value));
				expect(second).toEqual(first);
			}),
			options
		);
	});

	it('either round trips or says exactly why it cannot, for any text at all', () => {
		const reasons = new Set<string>();
		let written = 0;
		let refused = 0;
		fc.assert(
			fc.property(validDecks('anything'), (deck) => {
				const result = serializeMarkdown(deck);
				if (result.ok) {
					written++;
					expect(canon(mustParseMarkdown(result.value))).toEqual(canon(deck));
				} else {
					refused++;
					for (const problem of result.error) reasons.add(problem.code);
					expect(result.error.length).toBeGreaterThan(0);
				}
			}),
			options
		);
		// A refusal is only ever for a reason the format has: never a silent change.
		for (const reason of reasons) {
			expect(['leading_space', 'unclosed_fence', 'list_item', 'blank_line_in_choice']).toContain(
				reason
			);
		}
		// And most decks, even with unbalanced fences thrown in, can be written.
		expect(written).toBeGreaterThan(refused);
	});
});

describe('how text is written', () => {
	const deckWith = (card: Record<string, unknown>) =>
		mustParseJson(JSON.stringify({ tessera: 1, deck: { id: 'd', title: 'T' }, cards: [card] }));
	const write = (card: Record<string, unknown>) => {
		const result = serializeMarkdown(deckWith(card));
		if (!result.ok) throw new Error(JSON.stringify(result.error));
		return result.value;
	};

	it('escapes a line that would read as a label or heading, but not the first line', () => {
		const text = write({
			id: 'a',
			type: 'basic',
			front: 'Q: ask\nA: not a field\n## not a card\nfine',
			back: 'b'
		});
		expect(text).toContain('Q: Q: ask\n\\A: not a field\n\\## not a card\nfine\nA: b');
	});

	it('adds one more backslash to an already escaped line, so reading removes exactly one', () => {
		const text = write({ id: 'a', type: 'basic', front: 'x\n\\Q: literal', back: 'b' });
		expect(text).toContain('\\\\Q: literal');
	});

	it('leaves lines inside a code block alone', () => {
		const text = write({
			id: 'a',
			type: 'basic',
			front: 'show\n```\nA: output\n## header\n```\nend',
			back: 'b'
		});
		expect(text).toContain('```\nA: output\n## header\n```');
		expect(text).not.toContain('\\A: output');
	});

	it('writes a card with no id under a bare heading', () => {
		expect(write({ type: 'basic', front: 'f', back: 'b' })).toContain('\n##\nQ: f\nA: b');
	});

	it('marks the right choice and escapes list text', () => {
		const text = write({
			id: 'a',
			type: 'choice',
			front: 'q',
			choices: ['one', '[x] looks like a mark', 'three'],
			correct: 2
		});
		expect(text).toContain('- one\n- [ ] [x] looks like a mark\n- [x] three');
	});

	it('writes a multi-line choice with an indented continuation', () => {
		const text = write({
			id: 'a',
			type: 'choice',
			front: 'q',
			choices: ['first\nsecond', 'other'],
			correct: 1
		});
		expect(text).toContain('- first\n  second\n- [x] other');
	});

	it('escapes commas and backslashes in accepted answers', () => {
		const text = write({
			id: 'a',
			type: 'typed',
			front: 'q',
			answer: 'x',
			accept: ['ospf, eigrp', 'C:\\x']
		});
		expect(text).toContain('Accept: ospf\\, eigrp, C:\\\\x');
	});

	it('quotes YAML that needs it in the block at the top', () => {
		const result = serializeMarkdown(
			mustParseJson(
				JSON.stringify({
					tessera: 1,
					deck: { id: 'd', title: 'true', description: 'a: b' },
					cards: [{ id: 'a', type: 'basic', front: 'f', back: 'b' }]
				})
			)
		);
		if (!result.ok) throw new Error('should write');
		expect(mustParseMarkdown(result.value).deck).toMatchObject({
			title: 'true',
			description: 'a: b'
		});
	});

	it('keeps a long title on one line, so the file stays easy to read and edit', () => {
		const title = `Networking ${'fundamentals and more '.repeat(6)}end`;
		const result = serializeMarkdown(
			mustParseJson(
				JSON.stringify({
					tessera: 1,
					deck: { id: 'd', title },
					cards: [{ id: 'a', type: 'basic', front: 'f', back: 'b' }]
				})
			)
		);
		if (!result.ok) throw new Error('should write');
		expect(result.value).toContain(`\ntitle: ${title}\n`);
	});

	it('writes Windows line breaks inside a value as plain line breaks', () => {
		const text = write({ id: 'a', type: 'basic', front: 'one\r\ntwo\rthree', back: 'b' });
		expect(text).not.toContain('\r');
		expect(text).toContain('Q: one\ntwo\nthree\nA: b');
	});
});

describe('what the Markdown format cannot hold, said plainly', () => {
	const problems = (card: Record<string, unknown>) => {
		const deck = mustParseJson(
			JSON.stringify({ tessera: 1, deck: { id: 'd', title: 'T' }, cards: [card] })
		);
		const result = serializeMarkdown(deck);
		if (result.ok) throw new Error('expected a refusal');
		return result.error;
	};

	it('refuses text that starts with spaces', () => {
		const [problem] = problems({ id: 'a', type: 'basic', front: '   indented', back: 'b' });
		expect(problem).toMatchObject({ code: 'leading_space', path: 'cards[0].front' });
		expect(problem!.message).toContain('JSON');
	});

	it('refuses a code block that is never closed', () => {
		expect(
			problems({ id: 'a', type: 'basic', front: 'x\n```\nunclosed', back: 'b' })[0]
		).toMatchObject({
			code: 'unclosed_fence',
			path: 'cards[0].front'
		});
	});

	it('refuses an accepted answer with a line break or spaces around it', () => {
		expect(
			problems({ id: 'a', type: 'typed', front: 'q', answer: 'x', accept: ['a\nb'] })[0]
		).toMatchObject({ code: 'list_item' });
		expect(
			problems({ id: 'a', type: 'typed', front: 'q', answer: 'x', accept: [' padded'] })[0]
		).toMatchObject({ code: 'list_item' });
	});

	it('refuses a choice with an empty line inside it', () => {
		expect(
			problems({ id: 'a', type: 'choice', front: 'q', choices: ['a\n\nb', 'c'], correct: 0 })[0]
		).toMatchObject({
			code: 'blank_line_in_choice',
			path: 'cards[0].choices[0]'
		});
	});

	it('refuses a choice with no text, which a list item cannot hold, instead of writing "- "', () => {
		// The validator never lets this through, so the deck is built by hand to test the serializer alone.
		const deck = {
			tessera: 1,
			deck: { id: 'd', title: 'T' },
			cards: [{ id: 'a', type: 'choice', front: 'q', choices: ['', 'b'], correct: 1 }]
		} as unknown as Deck;
		const result = serializeMarkdown(deck);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error[0]).toMatchObject({ code: 'empty_choice', path: 'cards[0].choices[0]' });
		}
	});

	it('reports every problem, not only the first', () => {
		const result = problems({ id: 'a', type: 'basic', front: '  one', back: '  two' });
		expect(result.map((p) => p.path)).toEqual(['cards[0].front', 'cards[0].back']);
	});
});
