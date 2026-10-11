import { describe, expect, it } from 'vitest';
import { matchTyped, normalizeTyped } from '#lib/core/typed-match.ts';

const ok = (typed: string, answer: string, accept?: string[]) =>
	matchTyped(typed, answer, accept).correct;

describe('normalizeTyped', () => {
	it.each([
		['lower case', 'Show IP Route', 'show ip route'],
		['runs of spaces', 'show   ip    route', 'show ip route'],
		['tabs and line breaks', 'show\tip\nroute', 'show ip route'],
		['leading and trailing space', '  show ip route  ', 'show ip route'],
		['a non-breaking space', 'show ip route', 'show ip route'],
		['trailing sentence punctuation', 'show ip route.', 'show ip route'],
		['several trailing marks', 'really?!', 'really'],
		['punctuation then space', 'show ip route . ', 'show ip route'],
		['fullwidth letters', 'ＯＳＰＦ', 'ospf'],
		['a ligature', 'ﬁle', 'file'],
		['a decomposed accent', 'café', 'café'],
		['the German sharp s', 'Straße', 'strasse'],
		['a final Greek sigma', 'σοφος', 'σοφοσ']
	])('%s', (_name, input, expected) => {
		expect(normalizeTyped(input)).toBe(expected);
	});

	it('leaves everything inside the text alone', () => {
		expect(normalizeTyped('10.0.0.1')).toBe('10.0.0.1');
		expect(normalizeTyped('a-b_c/d')).toBe('a-b_c/d');
		expect(normalizeTyped('ip route 0.0.0.0 0.0.0.0')).toBe('ip route 0.0.0.0 0.0.0.0');
		expect(normalizeTyped('e.g. this')).toBe('e.g. this');
	});

	it('does not remove punctuation at the start', () => {
		expect(normalizeTyped('...hello')).toBe('...hello');
		expect(normalizeTyped('?why')).toBe('?why');
	});

	it('returns an empty string for nothing, space, or punctuation only', () => {
		expect(normalizeTyped('')).toBe('');
		expect(normalizeTyped('   \n ')).toBe('');
		expect(normalizeTyped('...')).toBe('');
	});

	it('is idempotent', () => {
		for (const text of ['Show IP Route.', '  A  B  ', 'ﬁle?!', '10.0.0.1.']) {
			expect(normalizeTyped(normalizeTyped(text))).toBe(normalizeTyped(text));
		}
	});
});

describe('matchTyped: what counts as right', () => {
	it.each([
		['exactly', 'show ip ospf neighbor', 'show ip ospf neighbor'],
		['in another case', 'SHOW IP OSPF NEIGHBOR', 'show ip ospf neighbor'],
		['with extra space', ' show  ip ospf   neighbor ', 'show ip ospf neighbor'],
		['with a full stop added', 'show ip ospf neighbor.', 'show ip ospf neighbor'],
		['when the card answer has the full stop', 'show ip ospf neighbor', 'Show IP OSPF neighbor.'],
		['an address with its dots', '10.0.0.1', '10.0.0.1'],
		['an address with a trailing dot', '10.0.0.1.', '10.0.0.1'],
		['a question mark answer', 'what?', 'What'],
		['a composed against a decomposed accent', 'café', 'café']
	])('accepts %s', (_name, typed, answer) => {
		expect(ok(typed, answer)).toBe(true);
	});

	it.each([
		['a different address', '10.0.0.2', '10.0.0.1'],
		['an address without its dots', '10001', '10.0.0.1'],
		['words in another order', 'route ip show', 'show ip route'],
		['a missing word', 'show route', 'show ip route'],
		['an extra word', 'show ip route now', 'show ip route'],
		['a prefix', 'show ip', 'show ip route'],
		['an abbreviation that is not listed', 'sh ip ro', 'show ip route'],
		['a hyphen removed', 'ab', 'a-b'],
		['a hyphen added', 'a-b', 'ab'],
		['an underscore changed', 'a_b', 'a-b'],
		['a different accent', 'cafe', 'café'],
		['leading punctuation removed', 'hello', '...hello']
	])('rejects %s', (_name, typed, answer) => {
		expect(ok(typed, answer)).toBe(false);
	});

	it('never accepts an empty answer, even for an answer that is only punctuation', () => {
		expect(ok('', 'show ip route')).toBe(false);
		expect(ok('   ', 'show ip route')).toBe(false);
		expect(ok('', '...')).toBe(false);
		expect(ok('...', '...')).toBe(false);
	});
});

describe('matchTyped: the accepted list', () => {
	const accept = ['sh ip ro', 'Show IP Route.', 'ip route'];

	it('accepts any alternative, with the same leniency as the main answer', () => {
		expect(ok('sh ip ro', 'show ip route', accept)).toBe(true);
		expect(ok('SH  IP  RO', 'show ip route', accept)).toBe(true);
		expect(ok('ip route.', 'show ip route', accept)).toBe(true);
	});

	it('still accepts the main answer when a list is given', () => {
		expect(ok('show ip route', 'show ip route', accept)).toBe(true);
	});

	it('does not accept something that is on no list', () => {
		expect(ok('sh route', 'show ip route', accept)).toBe(false);
	});

	it('reports which one matched, as written on the card', () => {
		expect(matchTyped('SH IP RO', 'show ip route', accept).matched).toBe('sh ip ro');
		expect(matchTyped('show ip route', 'show ip route', accept).matched).toBe('show ip route');
		expect(matchTyped('nope', 'show ip route', accept).matched).toBeUndefined();
	});

	it('treats a missing or empty list like no alternatives', () => {
		expect(ok('sh ip ro', 'show ip route')).toBe(false);
		expect(ok('sh ip ro', 'show ip route', [])).toBe(false);
	});
});

describe('matchTyped: the suggested grade', () => {
	it('suggests Good for a match and Again for a miss', () => {
		expect(matchTyped('x', 'x')).toEqual({ correct: true, matched: 'x', suggestedGrade: 3 });
		expect(matchTyped('y', 'x')).toEqual({ correct: false, matched: undefined, suggestedGrade: 1 });
	});
});

describe('robustness', () => {
	it('copes with lone surrogates, control characters, and very long input', () => {
		for (const text of [
			'\ud800',
			'\u0000\u0001',
			'a'.repeat(100_000),
			'​'.repeat(5000),
			'.'.repeat(50_000)
		]) {
			expect(() => matchTyped(text, 'answer', ['other'])).not.toThrow();
		}
	});

	it('stays fast on a long run of punctuation and space', () => {
		const started = performance.now();
		normalizeTyped(' .'.repeat(50_000));
		normalizeTyped('a' + ' '.repeat(100_000) + 'b');
		expect(performance.now() - started).toBeLessThan(500);
	});
});
