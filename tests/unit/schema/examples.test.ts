import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson } from '#lib/core/parse/index.ts';

// The README tells people to import these files, so they must always be valid.
const dir = 'examples';
const files = readdirSync(dir).filter((file) => file.endsWith('.json'));

describe('example decks', () => {
	it('exist', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)('%s imports cleanly', (file) => {
		const result = parseJson(readFileSync(join(dir, file), 'utf8'));
		if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
		expect(result.value.cards.length).toBeGreaterThan(0);
	});
});
