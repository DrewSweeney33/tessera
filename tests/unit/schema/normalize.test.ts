import { describe, expect, it } from 'vitest';
import { listClozeOrdinals } from '#lib/core/cloze.ts';
import {
	canonicalJson,
	normalizeCard,
	primaryText,
	reviewOrdinals
} from '#lib/core/schema/normalize.ts';
import type { Card } from '#lib/core/schema/index.ts';
import { fallbackKey, hashCard, sha256Hex } from '#lib/server/import/hash.ts';

const basic = (extra: Record<string, unknown> = {}): Card =>
	({ type: 'basic', front: 'Q', back: 'A', ...extra }) as Card;

describe('normalizeCard', () => {
	it('treats line endings, Unicode forms, and trailing whitespace as equivalent', () => {
		const a = normalizeCard(basic({ front: 'Line one\nLine two', back: 'Café' }));
		const b = normalizeCard(basic({ front: 'Line one\r\nLine two  \n\n', back: 'Café' }));
		expect(canonicalJson(b)).toBe(canonicalJson(a));
	});

	it('drops leading blank lines but keeps leading indentation of the first content line', () => {
		const card = normalizeCard(basic({ front: '\n \n    indented code' }));
		expect(card.content['front']).toBe('    indented code');
	});

	it('sorts and de-duplicates tags and accepted answers, and ignores empty lists', () => {
		const typed = normalizeCard({
			type: 'typed',
			front: 'Q',
			answer: 'A',
			accept: ['b', 'a', 'b'],
			tags: ['z', 'a', 'a']
		} as Card);
		expect(typed.content['accept']).toEqual(['a', 'b']);
		expect(typed.tags).toEqual(['a', 'z']);

		const none = normalizeCard(basic({ tags: [] }));
		expect(canonicalJson(none)).toBe(canonicalJson(normalizeCard(basic())));
	});

	it('keeps the order of choices, because correct is an index into them', () => {
		const make = (choices: string[]) =>
			normalizeCard({ type: 'choice', front: 'Q', choices, correct: 0 } as Card);
		expect(canonicalJson(make(['a', 'b']))).not.toBe(canonicalJson(make(['b', 'a'])));
	});

	it('keeps every authored field per type', () => {
		expect(
			normalizeCard({ type: 'cloze', text: '{{c1::x}}', extra: 'e', hint: 'h' } as Card).content
		).toEqual({ text: '{{c1::x}}', extra: 'e', hint: 'h' });
		expect(
			normalizeCard({
				type: 'choice',
				front: 'Q',
				choices: ['a', 'b'],
				correct: 1,
				explanation: 'why'
			} as Card).content
		).toEqual({ front: 'Q', choices: ['a', 'b'], correct: 1, explanation: 'why' });
	});

	it('exposes the id, source, and normalized source', () => {
		const card = normalizeCard(basic({ id: 'abc', source: 'Lesson 3  ' }));
		expect(card.id).toBe('abc');
		expect(card.source).toBe('Lesson 3');
		expect(normalizeCard(basic()).source).toBeUndefined();
	});
});

describe('primaryText and reviewOrdinals', () => {
	it('uses the front, or the text for cloze cards', () => {
		expect(primaryText(normalizeCard(basic()))).toBe('Q');
		expect(primaryText(normalizeCard({ type: 'cloze', text: '{{c1::x}} y' } as Card))).toBe(
			'{{c1::x}} y'
		);
	});

	it('gives one item for non-cloze cards and one per distinct number for cloze cards', () => {
		expect(reviewOrdinals(normalizeCard(basic()))).toEqual([0]);
		const cloze = (text: string) => normalizeCard({ type: 'cloze', text } as Card);
		expect(reviewOrdinals(cloze('{{c1::a}} {{c2::b}} {{c3::c}}'))).toEqual([1, 2, 3]);
		expect(reviewOrdinals(cloze('{{c1::a}} and {{c1::b}}'))).toEqual([1]);
		expect(reviewOrdinals(cloze('{{c3::a}} then {{c1::b}}'))).toEqual([1, 3]);
	});

	it('lists cloze numbers directly', () => {
		expect(listClozeOrdinals('no markers')).toEqual([]);
		expect(listClozeOrdinals('{{c10::x}} {{c2::y}}')).toEqual([2, 10]);
		expect(listClozeOrdinals('{{c0::x}} {{c100::y}} {{cx::z}}')).toEqual([]);
	});
});

describe('canonicalJson', () => {
	it('is independent of key order and drops undefined values', () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: undefined, e: [3, { z: 1, y: 2 }] } })).toBe(
			'{"a":{"d":2,"e":[3,{"y":2,"z":1}]},"b":1}'
		);
		expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
	});

	it('serializes scalars and nested arrays', () => {
		expect(canonicalJson(null)).toBe('null');
		expect(canonicalJson('x')).toBe('"x"');
		expect(canonicalJson([1, [2, 3]])).toBe('[1,[2,3]]');
	});
});

describe('hashCard and fallbackKey', () => {
	const hash = (card: Card) => hashCard(normalizeCard(card));

	it('is stable for equivalent input and sensitive to any real change', () => {
		const base = hash(basic({ tags: ['x', 'y'] }));
		expect(hash(basic({ tags: ['y', 'x'] }))).toBe(base);
		expect(hash(basic({ front: 'Q\r\n' }))).toBe(hash(basic({ front: 'Q' })));
		expect(hash(basic({ back: 'B', tags: ['x', 'y'] }))).not.toBe(base);
		expect(hash(basic({ tags: ['x'] }))).not.toBe(base);
		expect(hash(basic({ source: 'S' }))).not.toBe(hash(basic()));
		expect(hash(basic({ hint: 'h' }))).not.toBe(hash(basic()));
	});

	it('excludes the id, which is identity and not content', () => {
		expect(hash(basic({ id: 'one' }))).toBe(hash(basic({ id: 'two' })));
	});

	it('produces a 64 character hex digest', () => {
		expect(hash(basic())).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('derives a stable key from type and text, so type changes the key', () => {
		const key = (card: Card) => fallbackKey(normalizeCard(card));
		expect(key(basic())).toMatch(/^h-[0-9a-f]{12}$/);
		expect(key(basic({ front: 'Q\r\n', back: 'different' }))).toBe(key(basic()));
		expect(key(basic({ front: 'Another' }))).not.toBe(key(basic()));
		expect(key({ type: 'typed', front: 'Q', answer: 'A' } as Card)).not.toBe(key(basic()));
	});

	it('produces keys that satisfy the card id pattern', () => {
		expect(fallbackKey(normalizeCard(basic()))).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
	});
});
