// Writes the published JSON Schema from the Zod source of truth (ADR-001).
//   node scripts/emit-schema.ts          regenerate static/schema/tessera-deck.v1.schema.json
//   node scripts/emit-schema.ts --check  fail if the committed file is out of date (used in CI)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deckJsonSchema } from '#lib/core/schema/index.ts';

const target = 'static/schema/tessera-deck.v1.schema.json';
const expected = JSON.stringify(deckJsonSchema(), null, 2) + '\n';

if (process.argv.includes('--check')) {
	const actual = existsSync(target) ? readFileSync(target, 'utf8') : '';
	if (actual !== expected) {
		console.error(`${target} is out of date. Run: npm run schema:emit`);
		process.exit(1);
	}
	console.log(`${target} is up to date`);
} else {
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, expected);
	console.log(`wrote ${target}`);
}
