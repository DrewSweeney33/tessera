import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIMITS, deckJsonSchema, validateDeck, type ImportError } from '#lib/core/schema/index.ts';

const specExample = {
	tessera: 1,
	deck: { id: 'ccna-ospf', title: 'CCNA: OSPF', description: 'OSPF fundamentals', tags: ['ccna'] },
	cards: [
		{
			id: 'ospf-hello',
			type: 'basic',
			front: 'Default OSPF hello interval on broadcast networks?',
			back: '10 seconds',
			hint: 'Dead is 4x this',
			tags: ['timers'],
			source: 'Lesson 3'
		},
		{
			id: 'ospf-dr',
			type: 'cloze',
			text: 'The {{c1::DR}} is elected by highest {{c2::priority}}.',
			extra: 'Ties break on router ID.'
		},
		{
			id: 'ospf-show-nbr',
			type: 'typed',
			front: 'Command to list OSPF neighbors?',
			answer: 'show ip ospf neighbor',
			accept: ['sh ip ospf nei']
		},
		{
			id: 'ospf-lsa',
			type: 'choice',
			front: 'Which LSA type describes a network segment?',
			choices: ['Type 1', 'Type 2', 'Type 3', 'Type 5'],
			correct: 1,
			explanation: 'The DR originates Type 2.'
		}
	]
};

function deckWith(card: Record<string, unknown>) {
	return { tessera: 1, deck: { id: 'd', title: 'T' }, cards: [card] };
}

function errorsOf(input: unknown): ImportError[] {
	const result = validateDeck(input);
	if (result.ok) throw new Error('expected validation to fail');
	return result.error;
}

describe('validateDeck: valid decks', () => {
	it('accepts the spec example with all four card types', () => {
		const result = validateDeck(specExample);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.cards.map((c) => c.type)).toEqual(['basic', 'cloze', 'typed', 'choice']);
		}
	});

	it('accepts minimal cards without optional fields or ids', () => {
		expect(validateDeck(deckWith({ type: 'basic', front: 'Q', back: 'A' })).ok).toBe(true);
		expect(validateDeck(deckWith({ type: 'cloze', text: '{{c1::x}}' })).ok).toBe(true);
		expect(validateDeck(deckWith({ type: 'typed', front: 'Q', answer: 'A' })).ok).toBe(true);
		expect(
			validateDeck(deckWith({ type: 'choice', front: 'Q', choices: ['a', 'b'], correct: 0 })).ok
		).toBe(true);
	});

	it('accepts Markdown, code fences, and unicode in text fields', () => {
		const back = '```cisco\nshow ip route\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\nCafé ✓';
		expect(validateDeck(deckWith({ type: 'basic', front: 'Q', back })).ok).toBe(true);
	});
});

describe('validateDeck: error reporting', () => {
	const cases: {
		name: string;
		input: unknown;
		expected: { path: string; code: string; message?: string };
	}[] = [
		{
			name: 'missing required field',
			input: deckWith({ type: 'basic', back: 'x' }),
			expected: { path: 'cards[0].front', code: 'required', message: 'front is required' }
		},
		{
			name: 'wrong type',
			input: deckWith({ type: 'basic', front: 5, back: 'x' }),
			expected: {
				path: 'cards[0].front',
				code: 'wrong_type',
				message: 'front must be of type string, but found a number'
			}
		},
		{
			name: 'blank text',
			input: deckWith({ type: 'basic', front: '   ', back: 'x' }),
			expected: {
				path: 'cards[0].front',
				code: 'invalid_format',
				message: 'front must not be blank'
			}
		},
		{
			name: 'unsupported version',
			input: { ...specExample, tessera: 2 },
			expected: { path: 'tessera', code: 'unsupported_version', message: 'reads "tessera": 1' }
		},
		{
			name: 'missing version',
			input: { deck: specExample.deck, cards: specExample.cards },
			expected: { path: 'tessera', code: 'required', message: 'add "tessera": 1' }
		},
		{
			name: 'unknown card type',
			input: deckWith({ type: 'flip', front: 'Q' }),
			expected: {
				path: 'cards[0].type',
				code: 'invalid_value',
				message: 'basic, cloze, typed, choice'
			}
		},
		{
			name: 'missing card type',
			input: deckWith({ front: 'Q', back: 'A' }),
			expected: { path: 'cards[0].type', code: 'invalid_value', message: 'missing or non-text' }
		},
		{
			name: 'bad card id',
			input: deckWith({ id: 'Bad Id', type: 'basic', front: 'Q', back: 'A' }),
			expected: { path: 'cards[0].id', code: 'invalid_format', message: 'lowercase' }
		},
		{
			name: 'bad deck id',
			input: { ...specExample, deck: { id: 'UPPER', title: 'T' } },
			expected: { path: 'deck.id', code: 'invalid_format', message: 'deck id must start' }
		},
		{
			name: 'cloze without a marker',
			input: deckWith({ type: 'cloze', text: 'no markers here' }),
			expected: { path: 'cards[0].text', code: 'invalid_format', message: '{{c1::answer}}' }
		},
		{
			name: 'cloze number zero',
			input: deckWith({ type: 'cloze', text: '{{c0::x}}' }),
			expected: { path: 'cards[0].text', code: 'invalid_format' }
		},
		{
			name: 'cloze number above 99',
			input: deckWith({ type: 'cloze', text: '{{c100::x}}' }),
			expected: { path: 'cards[0].text', code: 'invalid_format' }
		},
		{
			name: 'too few choices',
			input: deckWith({ type: 'choice', front: 'Q', choices: ['x'], correct: 0 }),
			expected: {
				path: 'cards[0].choices',
				code: 'too_few',
				message: 'choices needs at least 2 items, found 1'
			}
		},
		{
			name: 'too many choices',
			input: deckWith({
				type: 'choice',
				front: 'Q',
				choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
				correct: 0
			}),
			expected: {
				path: 'cards[0].choices',
				code: 'too_many',
				message: 'at most 8 items, found 9'
			}
		},
		{
			name: 'correct index out of range',
			input: deckWith({ type: 'choice', front: 'Q', choices: ['x', 'y'], correct: 5 }),
			expected: {
				path: 'cards[0].correct',
				code: 'out_of_range',
				message: 'valid indexes are 0 to 1'
			}
		},
		{
			name: 'negative correct index',
			input: deckWith({ type: 'choice', front: 'Q', choices: ['x', 'y'], correct: -1 }),
			expected: { path: 'cards[0].correct', code: 'too_small' }
		},
		{
			name: 'duplicate choices',
			input: deckWith({ type: 'choice', front: 'Q', choices: ['Same', ' same ', 'x'], correct: 0 }),
			expected: {
				path: 'cards[0].choices[1]',
				code: 'duplicate_choice',
				message: 'repeats choice 0'
			}
		},
		{
			name: 'empty cards list',
			input: { ...specExample, cards: [] },
			expected: { path: 'cards', code: 'too_few', message: 'cards needs at least 1 item, found 0' }
		},
		{
			name: 'root is not an object',
			input: [],
			expected: { path: '(root)', code: 'wrong_type', message: 'but found an array' }
		},
		{
			name: 'overlong text',
			input: deckWith({ type: 'basic', front: 'x'.repeat(LIMITS.maxTextLength + 1), back: 'y' }),
			expected: { path: 'cards[0].front', code: 'too_long', message: 'found 20001' }
		},
		{
			name: 'tag with a comma',
			input: deckWith({ type: 'basic', front: 'Q', back: 'A', tags: ['a,b'] }),
			expected: { path: 'cards[0].tags[0]', code: 'invalid_format', message: 'commas' }
		}
	];

	it.each(cases)('$name', ({ input, expected }) => {
		const errors = errorsOf(input);
		const match = errors.find((e) => e.path === expected.path && e.code === expected.code);
		expect(match, JSON.stringify(errors)).toBeDefined();
		if (expected.message) expect(match!.message).toContain(expected.message);
	});

	it('reports one unknown_field error per key, listing the allowed fields for the card type', () => {
		const errors = errorsOf(deckWith({ type: 'basic', front: 'Q', back: 'A', extra: 1, bonus: 2 }));
		const unknown = errors.filter((e) => e.code === 'unknown_field');
		expect(unknown.map((e) => e.path)).toEqual(['cards[0].extra', 'cards[0].bonus']);
		expect(unknown[0]!.allowed).toContain('front');
		expect(unknown[0]!.allowed).not.toContain('choices');
		expect(unknown[0]!.message).toContain('Allowed fields here');
	});

	it('reports unknown fields at the document and deck level', () => {
		const errors = errorsOf({
			...specExample,
			nope: true,
			deck: { ...specExample.deck, colour: 'red' }
		});
		expect(errors.find((e) => e.path === 'nope')?.allowed).toEqual(['tessera', 'deck', 'cards']);
		expect(errors.find((e) => e.path === 'deck.colour')?.allowed).toContain('title');
	});

	it('detects duplicate card ids and points at the later card', () => {
		const errors = errorsOf({
			...specExample,
			cards: [
				{ id: 'same', type: 'basic', front: 'Q1', back: 'A1' },
				{ id: 'other', type: 'basic', front: 'Q2', back: 'A2' },
				{ id: 'same', type: 'basic', front: 'Q3', back: 'A3' }
			]
		});
		expect(errors).toContainEqual(
			expect.objectContaining({
				path: 'cards[2].id',
				code: 'duplicate_id',
				message: 'card id "same" is already used by cards[0]'
			})
		);
	});

	it('does not treat cards without ids as duplicates', () => {
		const result = validateDeck({
			...specExample,
			cards: [
				{ type: 'basic', front: 'Q1', back: 'A1' },
				{ type: 'basic', front: 'Q2', back: 'A2' }
			]
		});
		expect(result.ok).toBe(true);
	});

	it('sorts errors by position in the document', () => {
		const errors = errorsOf({
			tessera: 1,
			deck: { id: 'd', title: 'T' },
			cards: [
				{ type: 'basic', back: 'x' },
				{ type: 'basic', front: 'ok', back: 'ok' },
				{ type: 'basic', front: 'ok' }
			]
		});
		expect(errors.map((e) => e.path)).toEqual(['cards[0].front', 'cards[2].back']);
	});

	it('caps the error list and says how many were dropped', () => {
		// Each empty basic card is missing both front and back, so 60 cards produce 120 errors.
		const cards = Array.from({ length: 60 }, () => ({ type: 'basic' }));
		const errors = errorsOf({ tessera: 1, deck: { id: 'd', title: 'T' }, cards });
		expect(errors).toHaveLength(LIMITS.maxReportedErrors + 1);
		const last = errors[errors.length - 1]!;
		expect(last.code).toBe('too_many_errors');
		expect(last.message).toContain('70 more errors');
	});

	it('rejects more than the maximum number of cards', () => {
		const cards = Array.from({ length: LIMITS.maxCards + 1 }, (_, i) => ({
			id: `c${i}`,
			type: 'basic',
			front: 'Q',
			back: 'A'
		}));
		const errors = errorsOf({ tessera: 1, deck: { id: 'd', title: 'T' }, cards });
		expect(errors).toContainEqual(
			expect.objectContaining({
				path: 'cards',
				code: 'too_many',
				message: expect.stringContaining('5000')
			})
		);
	});
});

describe('deckJsonSchema', () => {
	it('is a draft 2020-12 schema that forbids unknown properties', () => {
		const schema = deckJsonSchema();
		expect(String(schema['$schema'])).toContain('2020-12');
		expect(schema['additionalProperties']).toBe(false);
		expect(schema['required']).toEqual(expect.arrayContaining(['tessera', 'deck', 'cards']));
		expect(String(schema['title'])).toContain('format version 1');
	});

	it('describes all four card types', () => {
		const text = JSON.stringify(deckJsonSchema());
		for (const type of ['basic', 'cloze', 'typed', 'choice']) {
			expect(text).toContain(`"const":"${type}"`);
		}
	});

	it('matches the committed static/schema file', () => {
		const committed = readFileSync('static/schema/tessera-deck.v1.schema.json', 'utf8');
		expect(committed).toBe(JSON.stringify(deckJsonSchema(), null, 2) + '\n');
	});
});
