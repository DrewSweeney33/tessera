import { describe, expect, it } from 'vitest';
import { buildFixRequest } from '#lib/core/fix-request.ts';

describe('buildFixRequest', () => {
	const origin = 'http://192.168.1.20:3000';

	it('names the format, the schema URL, and what to preserve', () => {
		const text = buildFixRequest(
			[{ path: 'cards[0].back', code: 'required', message: 'back is required' }],
			origin
		);
		expect(text).toContain('complete corrected deck as JSON only');
		expect(text).toContain('Keep every card "id" unchanged');
		expect(text).toContain('http://192.168.1.20:3000/api/schema');
	});

	it('numbers each problem with its path, code, and message', () => {
		const text = buildFixRequest(
			[
				{ path: 'cards[0].back', code: 'required', message: 'back is required' },
				{
					path: 'cards[2].type',
					code: 'invalid_value',
					message: 'type must be one of: basic',
					allowed: ['basic', 'cloze']
				}
			],
			origin
		);
		expect(text).toContain('1. cards[0].back [required]: back is required');
		expect(text).toContain(
			'2. cards[2].type [invalid_value]: type must be one of: basic (allowed: basic, cloze)'
		);
	});

	it('points at the line and column for syntax errors', () => {
		const text = buildFixRequest(
			[{ path: '(root)', code: 'invalid_json', message: 'Not valid JSON.', line: 7, column: 3 }],
			origin
		);
		expect(text).toContain('1. line 7, column 3 [invalid_json]: Not valid JSON.');
		expect(text).not.toContain('(root)');
	});

	it('tolerates a trailing slash on the origin and an empty list', () => {
		expect(buildFixRequest([], 'https://tessera.lan/')).toContain('https://tessera.lan/api/schema');
		expect(buildFixRequest([], 'https://tessera.lan/')).toMatch(/Problems:$/);
	});
});
