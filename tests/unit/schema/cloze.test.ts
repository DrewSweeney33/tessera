import { describe, expect, it } from 'vitest';
import {
	CLOZE_MAX_DEPTH,
	clozeSides,
	listClozeOrdinals,
	parseCloze,
	validateCloze
} from '#lib/core/cloze.ts';
import { validateDeck } from '#lib/core/schema/deck.ts';

const E = '…';

describe('listClozeOrdinals', () => {
	it.each([
		['no markers', 'plain text', []],
		['one marker', '{{c1::a}}', [1]],
		['sorted numerically, not as text', '{{c10::x}} {{c2::y}}', [2, 10]],
		['repeated numbers count once', '{{c1::a}} and {{c1::b}} and {{c2::c}}', [1, 2]],
		['nested markers count', '{{c1::outer {{c2::inner}} tail}}', [1, 2]],
		['an invalid number is ignored', '{{c0::x}} {{c100::y}} {{cx::z}} {{c01::w}}', []],
		['a valid one beside an invalid one', '{{c3::ok}} {{c0::bad}}', [3]],
		['a blank that is never closed still counts', 'start {{c4::never closed', [4]],
		['the highest number', '{{c99::x}}', [99]],
		['markers across lines', 'one {{c1::a}}\ntwo {{c2::b}}', [1, 2]]
	])('%s', (_name, text, expected) => {
		expect(listClozeOrdinals(text)).toEqual(expected);
	});
});

describe('clozeSides', () => {
	it('hides the asked number and shows the others', () => {
		const text = 'The {{c1::DR}} is elected by highest {{c2::priority}}, then router ID.';
		expect(clozeSides(text, 1).front).toBe(
			`The **[${E}]** is elected by highest priority, then router ID.`
		);
		expect(clozeSides(text, 2).front).toBe(
			`The DR is elected by highest **[${E}]**, then router ID.`
		);
		expect(clozeSides(text, 1).back).toBe(
			'The **DR** is elected by highest priority, then router ID.'
		);
	});

	it('shows the hint in place of the ellipsis', () => {
		expect(clozeSides('Value: {{c1::42::a number}}', 1).front).toBe('Value: **[a number]**');
		expect(clozeSides('Value: {{c1::42::a number}}', 1).back).toBe('Value: **42**');
	});

	it('trims whitespace around a hint and ignores an empty one', () => {
		expect(clozeSides('{{c1::x::  spaced  }}', 1).front).toBe('**[spaced]**');
		expect(clozeSides('{{c1::x::}}', 1).front).toBe(`**[${E}]**`);
	});

	it('hides every blank that shares the asked number', () => {
		expect(clozeSides('{{c1::a}} and {{c1::b}}', 1).front).toBe(`**[${E}]** and **[${E}]**`);
		expect(clozeSides('{{c1::a}} and {{c1::b}}', 1).back).toBe('**a** and **b**');
	});

	describe('nested blanks', () => {
		const text = 'Run {{c1::the {{c2::show}} command}} now.';

		it('hides the whole outer blank when the outer number is asked', () => {
			expect(clozeSides(text, 1).front).toBe(`Run **[${E}]** now.`);
			expect(clozeSides(text, 1).back).toBe('Run **the show command** now.');
		});

		it('shows the outer blank and hides only the inner one when the inner number is asked', () => {
			expect(clozeSides(text, 2).front).toBe(`Run the **[${E}]** command now.`);
			expect(clozeSides(text, 2).back).toBe('Run the **show** command now.');
		});

		it('handles a number nested inside itself by hiding all of it', () => {
			expect(clozeSides('{{c1::a {{c1::b}} c}}', 1).front).toBe(`**[${E}]**`);
		});
	});

	describe('ordinary braces and text', () => {
		it('leaves single braces and double braces that are not markers alone', () => {
			expect(clozeSides('config { a } and {{x}} and {{c}}', 1)).toEqual({
				front: 'config { a } and {{x}} and {{c}}',
				back: 'config { a } and {{x}} and {{c}}'
			});
		});

		it('keeps a stray closing marker as text', () => {
			expect(clozeSides('a }} b {{c1::x}} c }}', 1).front).toBe(`a }} b **[${E}]** c }}`);
		});

		it('keeps braces that touch a marker', () => {
			expect(clozeSides('{{{c1::x}}}', 1).front).toBe(`{**[${E}]**}`);
		});

		it('keeps a double colon outside a blank as text', () => {
			expect(clozeSides('std::vector {{c1::x}}', 1).front).toBe(`std::vector **[${E}]**`);
		});
	});

	it('keeps Markdown inside an answer, and across lines', () => {
		const text = 'Use {{c1::`show ip route`}}\nthen {{c2::**read** the table}}.';
		expect(clozeSides(text, 1).front).toBe(`Use **[${E}]**\nthen **read** the table.`);
		expect(clozeSides(text, 1).back).toBe('Use **`show ip route`**\nthen **read** the table.');
	});

	it('works with Unicode', () => {
		expect(clozeSides('日本の首都は{{c1::東京}}', 1).front).toBe(`日本の首都は**[${E}]**`);
	});

	it('returns the text unchanged when it has no markers', () => {
		expect(clozeSides('plain text', 1)).toEqual({ front: 'plain text', back: 'plain text' });
	});

	it('shows an invalid blank as its content, never as a hidden answer', () => {
		expect(clozeSides('{{c0::secret}} and {{c1::x}}', 1).front).toBe(`secret and **[${E}]**`);
	});
});

describe('validateCloze', () => {
	it('accepts well formed text, including nesting and hints', () => {
		expect(validateCloze('{{c1::a}} {{c2::b::hint}} {{c3::x {{c4::y}} z}}')).toEqual([]);
		expect(validateCloze('no markers at all')).toEqual([]);
	});

	it('reports a blank that is never closed, with its position', () => {
		const [issue, ...rest] = validateCloze('Line one\nA {{c2::missing the end');
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ code: 'unclosed_cloze', line: 2, column: 3 });
		expect(issue!.message).toContain('{{c2::');
		expect(issue!.message).toContain('Add }}');
		expect(issue!.message).toContain('line 2, column 3');
	});

	it('reports each unclosed blank in a nest', () => {
		const issues = validateCloze('{{c1::a {{c2::b');
		expect(issues.map((i) => i.code)).toEqual(['unclosed_cloze', 'unclosed_cloze']);
		// The inner blank starts at column 9 ({{c1::a plus a space is 8 characters), the outer at column 1.
		expect(issues.map((i) => i.column)).toEqual([9, 1]);
	});

	it.each([
		['a zero', '{{c0::x}}', '{{c0::'],
		['a number above 99', '{{c100::x}}', '{{c100::'],
		['a letter', '{{cx::x}}', '{{cx::'],
		['no number', '{{c::x}}', '{{c::'],
		['a leading zero', '{{c01::x}}', '{{c01::']
	])('reports %s as an invalid number', (_name, text, shown) => {
		const [issue] = validateCloze(text);
		expect(issue).toMatchObject({ code: 'invalid_cloze_number', line: 1, column: 1 });
		expect(issue!.message).toContain(shown);
		expect(issue!.message).toContain('from 1 to 99');
	});

	it.each([
		['nothing', '{{c1::}}'],
		['spaces', '{{c1::   }}'],
		['a line break', '{{c1::\n}}'],
		['only a hint', '{{c1::::hint}}']
	])('reports an empty answer (%s)', (_name, text) => {
		expect(validateCloze(text)[0]).toMatchObject({ code: 'empty_cloze' });
	});

	it('reports blanks nested deeper than the limit, once', () => {
		const deep = '{{c1::'.repeat(CLOZE_MAX_DEPTH + 3) + 'x' + '}}'.repeat(CLOZE_MAX_DEPTH + 3);
		const issues = validateCloze(deep);
		expect(issues.filter((i) => i.code === 'cloze_too_deep')).toHaveLength(1);
		expect(
			validateCloze('{{c1::'.repeat(CLOZE_MAX_DEPTH) + 'x' + '}}'.repeat(CLOZE_MAX_DEPTH))
		).toEqual([]);
	});

	it('reports several problems in one pass, up to a limit', () => {
		expect(validateCloze('{{c0::a}} {{c1::}} {{c2::b').map((i) => i.code)).toEqual([
			'invalid_cloze_number',
			'empty_cloze',
			'unclosed_cloze'
		]);
		const many = validateCloze('{{c0::x}} '.repeat(500));
		expect(many.length).toBeLessThanOrEqual(20);
	});
});

describe('robustness', () => {
	// Hostile or garbled text must neither throw nor take noticeable time.
	const pathological = [
		'{{c1::'.repeat(3000),
		'}}'.repeat(10_000),
		'{{c1::a}}'.repeat(2000),
		'::'.repeat(10_000),
		'{{c1::'.repeat(2000) + '}}'.repeat(2000),
		'{{c' + '9'.repeat(5000) + '::x}}',
		'{{'.repeat(10_000),
		'{{c1::' + 'a::'.repeat(5000) + '}}',
		'\u0000{{c1::\ud800}}'
	];

	it.each(pathological.map((text, i) => [i + 1, text] as const))(
		'handles pathological input %i quickly',
		(_i, text) => {
			const started = performance.now();
			expect(() => {
				parseCloze(text);
				listClozeOrdinals(text);
				clozeSides(text, 1);
			}).not.toThrow();
			expect(performance.now() - started).toBeLessThan(500);
		}
	);

	it('never throws on random garbage', () => {
		const alphabet = ['{', '}', ':', 'c', '1', '2', '9', 'x', ' ', '\n', '{{c1::', '}}', '::'];
		let seed = 12345;
		const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
		for (let n = 0; n < 500; n++) {
			let text = '';
			for (let k = 0; k < 40; k++) text += alphabet[next() % alphabet.length];
			expect(() => {
				parseCloze(text);
				clozeSides(text, 1);
			}, JSON.stringify(text)).not.toThrow();
		}
	});
});

describe('in a deck', () => {
	const deck = (text: string) => ({
		tessera: 1,
		deck: { id: 'd', title: 'D' },
		cards: [{ id: 'c1', type: 'cloze', text }]
	});

	it('imports a well formed cloze card', () => {
		expect(validateDeck(deck('The {{c1::DR}} wins.')).ok).toBe(true);
	});

	it('refuses a card with an unclosed blank and says where', () => {
		const result = validateDeck(deck('The {{c1::DR wins.'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toHaveLength(1);
		expect(result.error[0]).toMatchObject({ path: 'cards[0].text', code: 'unclosed_cloze' });
		expect(result.error[0]!.message).toContain('line 1, column 5');
	});

	it('refuses a bad number with its own code', () => {
		const result = validateDeck(deck('{{c1::ok}} and {{c0::bad}}'));
		if (result.ok) throw new Error('expected refusal');
		expect(result.error.map((e) => e.code)).toEqual(['invalid_cloze_number']);
	});

	it('still asks for at least one marker when there are none', () => {
		const result = validateDeck(deck('no markers here'));
		if (result.ok) throw new Error('expected refusal');
		expect(result.error[0]!.message).toContain('at least one cloze marker');
	});
});
