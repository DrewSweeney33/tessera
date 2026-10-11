import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// src/hooks.server.ts cannot be imported in a test (it needs SvelteKit's request store), so a deleted or
// reordered guard would pass every other unit test and only show up in the probe against a built server.
// This reads the real file and checks the pipeline itself.
const source = readFileSync('src/hooks.server.ts', 'utf8');
const sequence = /sequence\(([^)]*)\)/.exec(source)?.[1] ?? '';
const handlers = sequence
	.split(',')
	.map((part) => part.trim())
	.filter(Boolean);

describe('the request pipeline in src/hooks.server.ts', () => {
	it('runs the guards in this order', () => {
		// Logging wraps everything. Security headers cover even refused requests. The host check comes before
		// anything that reads the request. The token check is before the content type is judged, so a caller
		// without the token learns nothing about the API. The content type guard last.
		expect(handlers).toEqual([
			'requestLogging',
			'securityHeaders',
			'hostGuard',
			'apiTokenGuard',
			'contentTypeGuard'
		]);
	});

	it('imports every guard it uses from the hooks module', () => {
		for (const name of handlers)
			expect(source).toMatch(new RegExp(`\\b${name}\\b[\\s\\S]*hooks\\.ts`));
	});
});
