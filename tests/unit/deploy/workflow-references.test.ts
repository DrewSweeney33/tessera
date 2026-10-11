import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The workflows cannot run on a developer machine, and a mistake in one (a script that does not exist, a matrix
// key that is not defined, a job that is needed but not there) only shows up on GitHub, for the release workflow
// only when a real tag is pushed. These tests check every reference a workflow makes against the repository.

interface Step {
	id?: string;
	name?: string;
	uses?: string;
	run?: string;
	with?: Record<string, unknown>;
	env?: Record<string, unknown>;
	if?: string;
}
interface Job {
	needs?: string | string[];
	uses?: string;
	steps?: Step[];
	strategy?: { matrix?: Record<string, unknown[]> };
}

const folder = '.github/workflows';
const files = readdirSync(folder).filter((f) => f.endsWith('.yml'));
const scripts = (
	JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
).scripts;

function load(file: string): { jobs: Record<string, Job>; text: string } {
	const text = readFileSync(join(folder, file), 'utf8');
	return { jobs: (parse(text) as { jobs: Record<string, Job> }).jobs, text };
}

// Every combination of the matrix values a run line might use, for `${{ matrix.key }}`.
function expand(command: string, matrix: Record<string, unknown[]> | undefined): string[] {
	const keys = [...new Set([...command.matchAll(/\$\{\{ matrix\.(\w+) \}\}/g)].map((m) => m[1]!))];
	let results = [command];
	for (const key of keys) {
		const values = (matrix?.[key] ?? []).map(String);
		results = results.flatMap((c) => values.map((v) => c.replaceAll(`\${{ matrix.${key} }}`, v)));
	}
	return results;
}

describe.each(files)('%s', (file) => {
	const { jobs, text } = load(file);

	it('has jobs, and every job it needs exists', () => {
		expect(Object.keys(jobs).length).toBeGreaterThan(0);
		for (const [name, job] of Object.entries(jobs)) {
			for (const needed of [job.needs ?? []].flat()) {
				expect(Object.keys(jobs), `${name} needs ${needed}`).toContain(needed);
			}
		}
	});

	it('only calls workflows in this repository that exist', () => {
		const missing = Object.values(jobs)
			.map((job) => job.uses)
			.filter((uses): uses is string => uses !== undefined && uses.startsWith('./'))
			.filter((uses) => !existsSync(uses));
		expect(missing).toEqual([]);
	});

	it('runs only npm scripts that are defined in package.json', () => {
		const missing: string[] = [];
		for (const [name, job] of Object.entries(jobs)) {
			for (const step of job.steps ?? []) {
				for (const command of expand(step.run ?? '', job.strategy?.matrix)) {
					for (const match of command.matchAll(/npm run ([\w:.-]+)/g)) {
						if (!(match[1]! in scripts)) missing.push(`${name}: npm run ${match[1]}`);
					}
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('runs only files in the repository that exist', () => {
		const missing: string[] = [];
		for (const [name, job] of Object.entries(jobs)) {
			for (const step of job.steps ?? []) {
				for (const command of expand(step.run ?? '', job.strategy?.matrix)) {
					for (const match of command.matchAll(/node (scripts\/[\w./-]+\.ts)/g)) {
						if (!existsSync(match[1]!)) missing.push(`${name}: ${match[1]}`);
					}
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('uses only matrix keys that its job defines, and only step outputs from steps that come before', () => {
		const problems: string[] = [];
		for (const [name, job] of Object.entries(jobs)) {
			const ids = new Set<string>();
			for (const step of job.steps ?? []) {
				const own = JSON.stringify(step);
				for (const match of own.matchAll(/matrix\.(\w+)/g)) {
					if (!(match[1]! in (job.strategy?.matrix ?? {}))) {
						problems.push(`${name}: matrix.${match[1]} is not defined`);
					}
				}
				for (const match of own.matchAll(/steps\.([\w-]+)\.outputs/g)) {
					if (!ids.has(match[1]!))
						problems.push(`${name}: steps.${match[1]} is used before it exists`);
				}
				if (step.id) ids.add(step.id);
			}
		}
		expect(problems).toEqual([]);
	});

	it('does not put a value that others can influence straight into a shell command', () => {
		// github.event.* and github.head_ref can hold text chosen by whoever opened a pull request. They must go
		// through env, never ${{ }} inside run.
		for (const job of Object.values(jobs)) {
			for (const step of job.steps ?? []) {
				expect(step.run ?? '').not.toMatch(
					/\$\{\{\s*github\.(event\.|head_ref|ref_name)|\$\{\{\s*inputs\./
				);
			}
		}
		expect(text).not.toContain('pull_request_target');
	});
});

describe('the release workflow and the scripts it runs', () => {
	const { jobs } = load('release.yml');
	const publish = (jobs['publish']!.steps ?? [])
		.map((s) => `${s.name ?? ''}\n${s.run ?? ''}`)
		.join('\n');

	it('packages the assets before it uses them, and attaches exactly the files the script writes', () => {
		const packaging = publish.indexOf('node scripts/package-release-assets.ts');
		const attaching = publish.indexOf('gh release create');
		expect(packaging).toBeGreaterThan(-1);
		expect(attaching).toBeGreaterThan(packaging);
		for (const name of [
			'release-assets/tessera-deck.v1.schema.json',
			'release-assets/tessera-deck-skill-${VERSION}.zip',
			'release-assets/SHA256SUMS'
		]) {
			expect(publish, name).toContain(name);
		}
		const script = readFileSync('scripts/package-release-assets.ts', 'utf8');
		expect(script).toContain("'tessera-deck.v1.schema.json'");
		expect(script).toContain('tessera-deck-skill-${version}.zip');
		expect(script).toContain('SHA256SUMS');
	});

	it('checks the assets with the checksum file and with an unzip program that is not ours', () => {
		expect(publish).toContain('sha256sum -c SHA256SUMS');
		expect(publish).toContain('unzip -t');
		expect(publish).toContain('tessera-deck/SKILL.md');
	});
});
