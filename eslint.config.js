import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

// Layer rules from ADR-001 and the architect decisions:
//   core   (src/lib/core)    pure and isomorphic, imports nothing from server, ui, node, or SvelteKit
//   server (src/lib/server)  may import core, never ui
//   ui     (src/lib/ui)      may import core, never server
// Only core/scheduler imports ts-fsrs (ADR-003).
// Patterns use gitignore syntax, so a leading "#" must be escaped or it becomes a comment.
const noServer = {
	group: ['**/lib/server/**', '\\#lib/server', '\\#lib/server/**', '$lib/server', '$lib/server/**'],
	message: 'The ui layer and core must not import server code (ADR-001 layer rules).'
};
const noUi = {
	group: ['**/lib/ui/**', '\\#lib/ui', '\\#lib/ui/**', '$lib/ui', '$lib/ui/**'],
	message: 'The server layer and core must not import ui code (ADR-001 layer rules).'
};
const noPlatform = {
	group: ['node:*', '$app/*', '$env/*', '@sveltejs/*', 'svelte', 'svelte/*'],
	message: 'core is pure and isomorphic: no Node, SvelteKit, or Svelte imports.'
};
const noDbDriver = {
	name: 'better-sqlite3',
	message: 'Database drivers belong in src/lib/server/db only.'
};
const noTsFsrs = {
	name: 'ts-fsrs',
	message: 'Only src/lib/core/scheduler may import ts-fsrs (ADR-003).'
};
const noDrizzle = {
	name: 'drizzle-orm',
	message: 'Drizzle belongs in src/lib/server/db and src/lib/server/repos only.'
};

const restrict = ({ paths = [], patterns = [] }) => [
	'error',
	{ paths: [noTsFsrs, ...paths], patterns }
];

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	// ts-fsrs is confined everywhere except core/scheduler.
	{
		files: ['src/**/*.{ts,js,svelte}', 'tests/**/*.ts'],
		rules: { 'no-restricted-imports': restrict({}) }
	},
	{
		files: ['src/lib/core/**/*.ts'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [noDbDriver, noDrizzle],
				patterns: [noServer, noUi, noPlatform]
			})
		}
	},
	{
		files: ['src/lib/core/scheduler/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [noDbDriver, noDrizzle],
					patterns: [noServer, noUi, noPlatform]
				}
			]
		}
	},
	{
		files: ['src/lib/server/**/*.ts'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [noDbDriver, noDrizzle],
				patterns: [noUi]
			})
		}
	},
	// Database access is allowed only in db and repos.
	{
		files: ['src/lib/server/db/**/*.ts', 'src/lib/server/repos/**/*.ts'],
		rules: { 'no-restricted-imports': restrict({ patterns: [noUi] }) }
	},
	{
		files: ['src/lib/ui/**/*.{ts,svelte}'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [noDbDriver, noDrizzle],
				patterns: [noServer]
			})
		}
	},
	// Time and randomness are injected, never read directly in logic (ADR-003).
	{
		files: ['src/lib/core/**/*.ts', 'src/lib/server/**/*.ts'],
		ignores: ['src/lib/server/clock.ts'],
		rules: {
			'no-restricted-properties': [
				'error',
				{ object: 'Date', property: 'now', message: 'Inject a Clock or pass `now`.' },
				{ object: 'Math', property: 'random', message: 'Inject an rng function.' }
			],
			'no-restricted-syntax': [
				'error',
				{
					selector: "NewExpression[callee.name='Date'][arguments.length=0]",
					message: 'Inject a Clock or pass `now` instead of `new Date()`.'
				}
			]
		}
	},
	// {@html} is allowed only in the sanitizing Markdown component (ADR-005).
	{
		files: ['src/lib/ui/Markdown.svelte'],
		rules: { 'svelte/no-at-html-tags': 'off' }
	}
);
