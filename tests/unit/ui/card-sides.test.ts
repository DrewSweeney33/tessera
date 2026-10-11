import { describe, expect, it } from 'vitest';
import { clozeSides } from '#lib/core/cloze.ts';
import { cardSides } from '#lib/ui/card-sides.ts';

describe('clozeSides', () => {
	const text =
		'The {{c1::DR}} is elected by highest {{c2::priority}}, then {{c3::router ID::tie breaker}}.';

	it('hides only the asked blank in the question and reveals the others', () => {
		expect(clozeSides(text, 1).front).toBe(
			'The **[…]** is elected by highest priority, then router ID.'
		);
		expect(clozeSides(text, 2).front).toBe('The DR is elected by highest **[…]**, then router ID.');
	});

	it('shows the hint in place of the dots when there is one', () => {
		expect(clozeSides(text, 3).front).toContain('**[tie breaker]**');
	});

	it('bolds the asked answer and shows everything in the answer', () => {
		expect(clozeSides(text, 2).back).toBe(
			'The DR is elected by highest **priority**, then router ID.'
		);
	});

	it('treats repeated numbers as one blank and leaves text without blanks alone', () => {
		expect(clozeSides('{{c1::a}} and {{c1::b}}', 1).front).toBe('**[…]** and **[…]**');
		expect(clozeSides('plain text', 1)).toEqual({ front: 'plain text', back: 'plain text' });
	});
});

describe('cardSides', () => {
	it('splits a basic card', () => {
		expect(cardSides({ type: 'basic', ordinal: 0, content: { front: 'Q', back: 'A' } })).toEqual({
			kind: 'Question',
			front: 'Q',
			back: 'A'
		});
	});

	it('carries a hint when one exists', () => {
		const sides = cardSides({
			type: 'basic',
			ordinal: 0,
			content: { front: 'Q', back: 'A', hint: 'think' }
		});
		expect(sides.hint).toBe('think');
	});

	it('uses the asked blank for cloze cards and appends the extra text to the answer', () => {
		const sides = cardSides({
			type: 'cloze',
			ordinal: 2,
			content: { text: '{{c1::a}} {{c2::b}}', extra: 'More.' }
		});
		expect(sides.front).toBe('a **[…]**');
		expect(sides.back).toBe('a **b**\n\nMore.');
		expect(sides.kind).toBe('Fill in the blank');
	});

	it('shows a typed answer as code with its alternates', () => {
		const sides = cardSides({
			type: 'typed',
			ordinal: 0,
			content: { front: 'Command?', answer: 'show ip route', accept: ['sh ip route'] }
		});
		expect(sides.front).toBe('Command?');
		expect(sides.back).toContain('`show ip route`');
		expect(sides.back).toContain('Also accepted: `sh ip route`');
	});

	it('lists the choices and marks the correct one in the answer', () => {
		const sides = cardSides({
			type: 'choice',
			ordinal: 0,
			content: { front: 'Which?', choices: ['A', 'B', 'C'], correct: 1, explanation: 'Because.' }
		});
		expect(sides.front).toBe('Which?\n\n1. A\n2. B\n3. C');
		expect(sides.back).toBe('**2. B**\n\nBecause.');
	});

	it('does not crash on malformed stored content', () => {
		expect(() => cardSides({ type: 'choice', ordinal: 0, content: {} })).not.toThrow();
		expect(cardSides({ type: 'basic', ordinal: 0, content: {} })).toMatchObject({
			front: '',
			back: ''
		});
	});
});
