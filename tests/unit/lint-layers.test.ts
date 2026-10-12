import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// These tests prove the layer rules from ADR-001 and ADR-003 actually fail the build.
// Type-aware parsing is switched off for .svelte so snippets can be linted without real files.
const eslint = new ESLint({
	cwd: process.cwd(),
	overrideConfig: [
		{
			files: ['**/*.svelte'],
			languageOptions: { parserOptions: { projectService: false } }
		}
	]
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

// The first lint of the run loads the whole type-aware project, which takes several seconds on a busy machine, so
// these tests get more time than the default five seconds.
describe('layer lint rules', { timeout: 60_000 }, () => {
	it('forbids core importing server code', async () => {
		const ids = await ruleIds(
			"import { db } from '#lib/server/db/client';\nexport const x = db;\n",
			'src/lib/core/example.ts'
		);
		expect(ids).toContain('no-restricted-imports');
	});

	it('forbids core importing node built-ins', async () => {
		const ids = await ruleIds(
			"import { createHash } from 'node:crypto';\nexport const x = createHash;\n",
			'src/lib/core/example.ts'
		);
		expect(ids).toContain('no-restricted-imports');
	});

	it('forbids ui importing server code', async () => {
		const ids = await ruleIds(
			"import { db } from '#lib/server/db/client';\nexport const x = db;\n",
			'src/lib/ui/example.ts'
		);
		expect(ids).toContain('no-restricted-imports');
	});

	it('forbids server importing ui code', async () => {
		const ids = await ruleIds(
			"import { x } from '#lib/ui/tokens';\nexport const y = x;\n",
			'src/lib/server/example.ts'
		);
		expect(ids).toContain('no-restricted-imports');
	});

	it('confines ts-fsrs to core/scheduler', async () => {
		const code = "import { fsrs } from 'ts-fsrs';\nexport const f = fsrs;\n";
		expect(await ruleIds(code, 'src/lib/server/example.ts')).toContain('no-restricted-imports');
		expect(await ruleIds(code, 'src/lib/core/example.ts')).toContain('no-restricted-imports');
		expect(await ruleIds(code, 'src/lib/core/scheduler/index.ts')).not.toContain(
			'no-restricted-imports'
		);
	});

	it('forbids reading the clock or randomness in core and server logic', async () => {
		expect(await ruleIds('export const t = Date.now();\n', 'src/lib/core/example.ts')).toContain(
			'no-restricted-properties'
		);
		expect(
			await ruleIds('export const r = Math.random();\n', 'src/lib/server/example.ts')
		).toContain('no-restricted-properties');
		expect(await ruleIds('export const d = new Date();\n', 'src/lib/server/example.ts')).toContain(
			'no-restricted-syntax'
		);
	});

	it('allows the clock module to read real time', async () => {
		const ids = await ruleIds(
			'export const now = () => new Date();\nexport const t = Date.now();\n',
			'src/lib/server/clock.ts'
		);
		expect(ids).not.toContain('no-restricted-syntax');
		expect(ids).not.toContain('no-restricted-properties');
	});

	it('allows {@html} only in Markdown.svelte', async () => {
		const code = '<script lang="ts">\n\tlet html = $state("");\n</script>\n\n{@html html}\n';
		expect(await ruleIds(code, 'src/lib/ui/Other.svelte')).toContain('svelte/no-at-html-tags');
		expect(await ruleIds(code, 'src/lib/ui/Markdown.svelte')).not.toContain(
			'svelte/no-at-html-tags'
		);
	});
});
