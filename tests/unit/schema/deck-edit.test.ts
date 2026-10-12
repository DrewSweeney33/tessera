import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckCardDto, DeckDocumentDto } from '#lib/core/api-types.ts';
import {
	CARD_TYPES,
	blankCard,
	cardPreviewText,
	cardProblems,
	changeSummary,
	deckProblems,
	newCardId,
	tidyCard,
	tidyDeck
} from '#lib/core/deck-edit.ts';
import { ID_PATTERN, LIMITS } from '#lib/core/schema/limits.ts';
import { validateDeck } from '#lib/core/schema/index.ts';

// The pure part of the deck editor (ADR-013): blank cards, the checks made before a save, tidying a card the way a
// save needs it, and a count of what changed. The server checks everything again. What matters here is that the
// editor never changes a card it was not asked to change, and never says "fine" to a card the server would refuse
// for the common reasons.

const valid = (card: Record<string, unknown>): DeckCardDto => card as DeckCardDto;
const asDeck = (cards: DeckCardDto[]): DeckDocumentDto => ({
	tessera: 1,
	deck: { id: 'd', title: 'Deck' },
	cards
});
const accepted = (cards: DeckCardDto[]) => validateDeck(asDeck(cards).valueOf()).ok;

describe('newCardId', () => {
	it('makes an id the schema accepts, from a short random part', () => {
		const id = newCardId(new Set());
		expect(id).toMatch(/^card-[0-9a-f]{8}$/);
		expect(ID_PATTERN.test(id)).toBe(true);
	});

	it('never repeats an id that is taken, even when luck keeps giving the same answer', () => {
		const taken = new Set<string>();
		for (let i = 0; i < 300; i++) taken.add(newCardId(taken, () => 0.5));
		expect(taken.size).toBe(300);
		for (const id of taken) expect(ID_PATTERN.test(id), id).toBe(true);
	});

	it('two ids made one after the other differ', () => {
		const ids = new Set(Array.from({ length: 200 }, () => newCardId(new Set())));
		expect(ids.size).toBeGreaterThan(195);
	});
});

describe('blankCard', () => {
	it.each(CARD_TYPES)('makes an empty %s card of that type with the given id', (type) => {
		const card = blankCard(type, 'x1');
		expect(card.type).toBe(type);
		expect(card.id).toBe('x1');
	});

	it('starts every kind with something to fill in, and every kind needs filling in', () => {
		for (const type of CARD_TYPES) {
			expect(cardProblems(blankCard(type, 'x1')).length, type).toBeGreaterThan(0);
		}
	});

	it('gives a multiple choice card two empty choices to start with', () => {
		expect(blankCard('choice', 'x')).toMatchObject({ choices: ['', ''], correct: 0 });
	});
});

describe('cardProblems', () => {
	const cases: [string, Record<string, unknown>, string][] = [
		['a basic card with no front', { id: 'a', type: 'basic', front: '  ', back: 'A' }, 'front'],
		['a basic card with no back', { id: 'a', type: 'basic', front: 'Q', back: '' }, 'back'],
		['a cloze with no marker', { id: 'a', type: 'cloze', text: 'No blank here' }, 'text'],
		[
			'a cloze with an unclosed marker',
			{ id: 'a', type: 'cloze', text: 'Open {{c1::never closed' },
			'text'
		],
		[
			'a cloze with an empty answer',
			{ id: 'a', type: 'cloze', text: 'Empty {{c1::}} blank' },
			'text'
		],
		['a typed card with no answer', { id: 'a', type: 'typed', front: 'Q', answer: ' ' }, 'answer'],
		['a typed card with no question', { id: 'a', type: 'typed', front: '', answer: 'x' }, 'front'],
		[
			'a choice card with one choice',
			{ id: 'a', type: 'choice', front: 'Q', choices: ['only'], correct: 0 },
			'choices'
		],
		[
			'a choice card with a blank choice among others',
			{ id: 'a', type: 'choice', front: 'Q', choices: ['a', '', 'c'], correct: 0 },
			'choices[1]'
		],
		[
			'a choice card whose right answer is out of range',
			{ id: 'a', type: 'choice', front: 'Q', choices: ['a', 'b'], correct: 2 },
			'correct'
		],
		[
			'a choice card with too many choices',
			{
				id: 'a',
				type: 'choice',
				front: 'Q',
				choices: Array.from({ length: 9 }, (_, i) => `c${i}`),
				correct: 0
			},
			'choices'
		],
		[
			'text over the length limit',
			{ id: 'a', type: 'basic', front: 'x'.repeat(LIMITS.maxTextLength + 1), back: 'A' },
			'front'
		],
		[
			'a hint over the length limit',
			{ id: 'a', type: 'basic', front: 'Q', back: 'A', hint: 'h'.repeat(LIMITS.maxTextLength + 1) },
			'hint'
		],
		[
			'a tag with a comma',
			{ id: 'a', type: 'basic', front: 'Q', back: 'A', tags: ['a,b'] },
			'tags'
		],
		[
			'an accepted answer over the length limit',
			{
				id: 'a',
				type: 'typed',
				front: 'Q',
				answer: 'x',
				accept: ['y'.repeat(LIMITS.maxAcceptLength + 1)]
			},
			'accept'
		],
		[
			'too many accepted answers',
			{
				id: 'a',
				type: 'typed',
				front: 'Q',
				answer: 'x',
				accept: Array.from({ length: LIMITS.maxAccept + 1 }, (_, i) => `a${i}`)
			},
			'accept'
		]
	];

	it.each(cases)('finds the problem in %s, at the field %s', (_label, card, field) => {
		const problems = cardProblems(valid(card));
		expect(problems.map((p) => p.field)).toContain(field);
		for (const problem of problems) expect(problem.message.length).toBeGreaterThan(5);
	});

	it.each([
		{ id: 'a', type: 'basic', front: 'Q', back: 'A' },
		{ id: 'a', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}' },
		{ id: 'a', type: 'typed', front: 'Q', answer: 'x', accept: ['y'] },
		{ id: 'a', type: 'choice', front: 'Q', choices: ['a', 'b'], correct: 1, explanation: 'Because' }
	])('finds nothing wrong with a good %#', (card) => {
		expect(cardProblems(valid(card))).toEqual([]);
	});

	it('does not count a blank accepted answer as a problem, since saving drops it', () => {
		const card = valid({
			id: 'a',
			type: 'typed',
			front: 'Q',
			answer: 'x',
			accept: ['', 'y', '  ']
		});
		expect(cardProblems(card)).toEqual([]);
		expect(tidyCard(card)).toMatchObject({ accept: ['y'] });
	});

	it('what it passes, the server passes: any card it finds fine is accepted by the deck rules (property test)', () => {
		const text = fc.oneof(
			fc.constant(''),
			fc.constant('   '),
			fc.string({ maxLength: 40 }),
			fc.constant('The {{c1::DR}}'),
			fc.constant('{{c1::a}} and {{c2::b}}'),
			fc.constant('{{c1::unclosed'),
			fc.constant('{{c0::bad}}')
		);
		const card = fc.oneof(
			fc.record({ id: fc.constant('a'), type: fc.constant('basic'), front: text, back: text }),
			fc.record({ id: fc.constant('a'), type: fc.constant('cloze'), text }),
			fc.record({ id: fc.constant('a'), type: fc.constant('typed'), front: text, answer: text }),
			fc.record({
				id: fc.constant('a'),
				type: fc.constant('choice'),
				front: text,
				choices: fc.array(text, { minLength: 0, maxLength: 9 }),
				correct: fc.integer({ min: -1, max: 9 })
			})
		);
		fc.assert(
			fc.property(card, (candidate) => {
				const asCard = candidate as unknown as DeckCardDto;
				if (cardProblems(asCard).length === 0) {
					expect(accepted([tidyCard(asCard)]), JSON.stringify(candidate)).toBe(true);
				}
			}),
			{ numRuns: 800 }
		);
	});
});

describe('tidyCard', () => {
	it('drops optional fields that are empty, and keeps the ones with something in them', () => {
		const tidy = tidyCard(
			valid({
				id: 'a',
				type: 'basic',
				front: 'Q',
				back: 'A',
				hint: '',
				source: '  ',
				tags: [],
				extra: undefined
			})
		);
		expect(tidy).toEqual({ id: 'a', type: 'basic', front: 'Q', back: 'A' });
		expect(
			tidyCard(valid({ id: 'a', type: 'basic', front: 'Q', back: 'A', hint: 'h', tags: ['x'] }))
		).toMatchObject({
			hint: 'h',
			tags: ['x']
		});
	});

	it('cleans tags: trims them, drops blanks and repeats', () => {
		const tidy = tidyCard(
			valid({ id: 'a', type: 'basic', front: 'Q', back: 'A', tags: [' a ', '', 'b', 'a', '  '] })
		);
		expect(tidy['tags']).toEqual(['a', 'b']);
	});

	it('leaves the main text exactly as typed, because the server normalizes it and decides what counts as a change', () => {
		const card = valid({ id: 'a', type: 'basic', front: '  Q with spaces  ', back: 'A\n\n' });
		expect(tidyCard(card)).toMatchObject({ front: '  Q with spaces  ', back: 'A\n\n' });
	});

	it('does not touch a field it does not know about', () => {
		const card = valid({
			id: 'a',
			type: 'basic',
			front: 'Q',
			back: 'A',
			future: { nested: [1, 2] }
		});
		expect(tidyCard(card)['future']).toEqual({ nested: [1, 2] });
	});

	it('is idempotent (property test)', () => {
		fc.assert(
			fc.property(
				fc.record({
					id: fc.constant('a'),
					type: fc.constant('basic'),
					front: fc.string(),
					back: fc.string(),
					hint: fc.option(fc.string(), { nil: undefined }),
					tags: fc.option(fc.array(fc.string()), { nil: undefined })
				}),
				(card) => {
					const once = tidyCard(card as unknown as DeckCardDto);
					expect(tidyCard(once)).toEqual(once);
				}
			),
			{ numRuns: 300 }
		);
	});
});

describe('tidyDeck and changeSummary: an untouched deck is untouched', () => {
	const folder = 'tests/fixtures/decks/valid';
	const fixtures = readdirSync(folder).filter((name) => name.endsWith('.json'));

	it.each(fixtures)('saving %s unchanged changes nothing', (name) => {
		const parsed = validateDeck(JSON.parse(readFileSync(join(folder, name), 'utf8')));
		if (!parsed.ok) throw new Error('invalid fixture');
		const original = parsed.value as unknown as DeckDocumentDto;
		const saved = tidyDeck(structuredClone(original));
		const summary = changeSummary(original, saved);
		expect(summary).toEqual({
			changed: 0,
			added: 0,
			removed: 0,
			detailsChanged: false,
			any: false
		});
		expect(saved.cards).toHaveLength(original.cards.length);
	});

	it('counts an edited card, an added card, a removed card, and a changed title', () => {
		const original = asDeck([
			valid({ id: 'a', type: 'basic', front: 'Q a', back: 'A a' }),
			valid({ id: 'b', type: 'basic', front: 'Q b', back: 'A b' }),
			valid({ id: 'c', type: 'basic', front: 'Q c', back: 'A c' })
		]);
		const draft: DeckDocumentDto = {
			...original,
			deck: { ...original.deck, title: 'Renamed' },
			cards: [
				valid({ id: 'a', type: 'basic', front: 'Q a', back: 'A a changed' }),
				valid({ id: 'c', type: 'basic', front: 'Q c', back: 'A c' }),
				valid({ id: 'd', type: 'basic', front: 'Q d', back: 'A d' })
			]
		};
		expect(changeSummary(original, draft)).toEqual({
			changed: 1,
			added: 1,
			removed: 1,
			detailsChanged: true,
			any: true
		});
	});

	it('does not count a card whose only difference is an empty optional field', () => {
		const original = asDeck([valid({ id: 'a', type: 'basic', front: 'Q', back: 'A' })]);
		const draft = asDeck([
			valid({ id: 'a', type: 'basic', front: 'Q', back: 'A', hint: '', tags: [] })
		]);
		expect(changeSummary(original, draft).any).toBe(false);
	});

	it('does not count tags in another order as a change', () => {
		const original = asDeck([
			valid({ id: 'a', type: 'basic', front: 'Q', back: 'A', tags: ['x', 'y'] })
		]);
		const draft = asDeck([
			valid({ id: 'a', type: 'basic', front: 'Q', back: 'A', tags: ['y', 'x'] })
		]);
		expect(changeSummary(original, draft).any).toBe(false);
	});

	it('tidies the deck details: trims the title, and leaves out an empty description and tags', () => {
		const tidy = tidyDeck({
			tessera: 1,
			deck: { id: 'd', title: '  Padded  ', description: '   ', tags: [' a ', '', 'a'] },
			cards: []
		});
		expect(tidy.deck).toEqual({ id: 'd', title: 'Padded', tags: ['a'] });
	});
});

describe('deckProblems', () => {
	it('wants a title and at least one card, and says why a deck with none cannot be saved', () => {
		const none = deckProblems({ tessera: 1, deck: { id: 'd', title: ' ' }, cards: [] });
		expect(none.map((p) => p.field)).toEqual(expect.arrayContaining(['title', 'cards']));
		expect(none.find((p) => p.field === 'cards')!.message).toMatch(/at least one card/);
	});

	it('refuses more cards than the deck format allows', () => {
		const many = Array.from({ length: LIMITS.maxCards + 1 }, (_, i) =>
			valid({ id: `c${i}`, type: 'basic', front: 'Q', back: 'A' })
		);
		expect(deckProblems(asDeck(many)).map((p) => p.field)).toContain('cards');
	});

	it('finds nothing wrong with a good deck', () => {
		expect(
			deckProblems(asDeck([valid({ id: 'a', type: 'basic', front: 'Q', back: 'A' })]))
		).toEqual([]);
	});
});

describe('cardPreviewText', () => {
	it.each([
		[{ id: 'a', type: 'basic', front: 'What is OSPF?', back: 'x' }, 'What is OSPF?'],
		[{ id: 'a', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}' }, 'The [DR] and [BDR]'],
		[{ id: 'a', type: 'cloze', text: 'A {{c1::hidden::a hint}} word' }, 'A [hidden] word'],
		[{ id: 'a', type: 'typed', front: 'Command?\n\nLine two', answer: 'x' }, 'Command? Line two'],
		[{ id: 'a', type: 'choice', front: 'Pick one', choices: ['a', 'b'], correct: 0 }, 'Pick one'],
		[{ id: 'a', type: 'basic', front: '', back: 'x' }, '(empty)'],
		[{ id: 'a', type: 'basic', front: '   \n  ', back: 'x' }, '(empty)']
	])('shows %j as %j', (card, shown) => {
		expect(cardPreviewText(valid(card))).toBe(shown);
	});

	it('is one line of at most a hundred characters, however long the text is', () => {
		const shown = cardPreviewText(
			valid({ id: 'a', type: 'basic', front: `${'word '.repeat(100)}\nmore`, back: 'x' })
		);
		expect(shown.length).toBeLessThanOrEqual(100);
		expect(shown).not.toContain('\n');
		expect(shown.endsWith('…')).toBe(true);
	});
});
