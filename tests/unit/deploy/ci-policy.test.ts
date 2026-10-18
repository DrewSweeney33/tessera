import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// GitHub Actions cannot run on a developer machine, so these tests keep the workflow honest as policy:
// actions pinned to commit SHAs, least privilege, and every gate from the staff-engineer standard present.
const text = readFileSync('.github/workflows/ci.yml', 'utf8');
const workflow = parse(text) as {
	permissions: Record<string, string>;
	jobs: Record<
		string,
		{
			needs?: string;
			if?: string;
			steps: { uses?: string; run?: string; name?: string }[];
			strategy?: { matrix: { platform: string } };
		}
	>;
};
const dependabot = parse(readFileSync('.github/dependabot.yml', 'utf8')) as {
	updates: {
		'package-ecosystem': string;
		ignore?: { 'dependency-name': string }[];
		groups?: Record<string, { patterns?: string[] }>;
	}[];
};

const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const commands = allSteps.map((step) => step.run ?? '').join('\n');

describe('CI workflow', () => {
	it('pins every action to a full commit SHA with a version comment', () => {
		const lines = text.split('\n').filter((l) => l.includes('uses:'));
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line, line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
		}
	});

	it('grants only read access to repository contents', () => {
		expect(workflow.permissions).toEqual({ contents: 'read' });
	});

	it('runs the type check, lint, schema check, unit and integration tests, audit, license check, and a smoke test', () => {
		expect(commands).toContain('npm ci');
		// Everything `npm run verify` runs locally, as separate jobs that run at the same time.
		for (const command of [
			'npm run check',
			'npm run lint',
			'npm run schema:check',
			'npm test',
			'npm run test:integration'
		]) {
			expect(commands, command).toContain(command);
		}
		const verify = JSON.parse(readFileSync('package.json', 'utf8')).scripts.verify as string;
		for (const part of verify.split(' && ')) {
			expect(commands, part).toContain(
				part.replace('npm run test:integration', 'npm run test:integration')
			);
		}
		expect(commands).toContain('npm run audit:prod');
		expect(commands).toContain('npm run licenses');
		expect(commands).toContain('npm run build');
		expect(commands).toContain('npm run smoke');
	});

	it('runs the checks as parallel jobs, and keeps one job named Verify that fails if any of them did', () => {
		const names = ['static', 'unit', 'integration', 'server', 'security'];
		for (const name of names) {
			expect(workflow.jobs[name], name).toBeDefined();
			expect(workflow.jobs[name]!.needs, name).toBeUndefined();
		}
		const verify = workflow.jobs['verify']! as unknown as {
			needs: string[];
			name: string;
			steps: { run?: string }[];
		};
		expect(verify.name).toBe('Verify');
		expect([...verify.needs].sort()).toEqual([...names].sort());
		const run = verify.steps.map((step) => step.run ?? '').join('\n');
		expect(run).toContain("contains(needs.*.result, 'failure')");
		expect(run).toContain("contains(needs.*.result, 'cancelled')");
		expect(run).toContain("contains(needs.*.result, 'skipped')");
	});

	it('runs every check against the built server', () => {
		expect(commands).toContain('npm run benchmark');
		expect(commands).toContain('npm run benchmark:stats');
		expect(commands).toContain('npm run security:probe');
		// The probe's remote mode is what the live-image harness relies on, so it is checked on every push.
		expect(commands).toContain('npm run probe:remote-check');
		expect(commands).toContain('npm run durability');
		expect(commands).toContain('npm run ops:check');
	});

	it('runs the browser tests in Chromium, Firefox, and WebKit in shards on their own runners, WebKit in eight', () => {
		const browsers = workflow.jobs['browsers']!;
		const matrix = (
			browsers.strategy as unknown as {
				matrix: {
					browser: string[];
					shard: number[];
					include: { browser: string; shard: number; shards: number }[];
				};
			}
		).matrix;
		expect(browsers.needs).toBeUndefined();
		expect(matrix.browser).toEqual(['chromium', 'firefox']);
		// Four shards of one browser are four jobs with four servers and four empty data folders, so the specs, which
		// import decks with fixed ids into one shared server, never meet another shard's data.
		expect(matrix.shard).toEqual([1, 2, 3, 4]);
		// WebKit is about 2.5 times slower than Chromium, so it has eight.
		expect(
			matrix.include.map((entry) => `${entry.browser} ${entry.shard}/${entry.shards}`)
		).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((shard) => `webkit ${shard}/8`));
		expect(text).toContain('--shard=${{ matrix.shard }}/${{ matrix.shards || 4 }}');
		const run = browsers.steps.map((step) => step.run ?? '').join('\n');
		expect(run).toContain('npm ci');
		expect(run).toContain('npm run build');
		expect(run).toContain('npx playwright install --with-deps ${{ matrix.browser }}');
		expect(run).toContain('npm run test:e2e:${{ matrix.browser }} -- --shard=');
		// Every browser the job names has a script that runs it.
		const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
			string,
			string
		>;
		for (const browser of ['chromium', 'firefox', 'webkit']) {
			expect(scripts[`test:e2e:${browser}`], browser).toBe(`node scripts/run-e2e.ts ${browser}`);
		}
		expect(text).toMatch(/browsers:[\s\S]*?timeout-minutes: 15/);
	});

	it('keeps the downloaded browsers between runs, keyed by the lockfile and the browser', () => {
		const step = workflow.jobs['browsers']!.steps.find((s) => s.uses?.startsWith('actions/cache@'));
		expect(step, 'a cache step').toBeDefined();
		expect(text).toContain('path: ~/.cache/ms-playwright');
		expect(text).toContain(
			"playwright-${{ runner.os }}-${{ matrix.browser }}-${{ hashFiles('package-lock.json') }}"
		);
	});

	it('does not run the browser tests inside the verify job, so verify and the browsers run at the same time', () => {
		expect(workflow.jobs['verify']!.steps.map((step) => step.run ?? '').join('\n')).not.toContain(
			'test:e2e'
		);
	});

	it('does not start for a change that only touches the planning notes in .10x', () => {
		const on = (
			parse(text) as {
				on: { push: { 'paths-ignore': string[] }; pull_request: { 'paths-ignore': string[] } };
			}
		).on;
		expect(on.push['paths-ignore']).toEqual(['.10x/**']);
		expect(on.pull_request['paths-ignore']).toEqual(['.10x/**']);
	});

	it('lets the release run only the container checks, and skips every other job then', () => {
		const call = (
			parse(text) as { on: { workflow_call: { inputs: { scope: { default: string } } } } }
		).on.workflow_call;
		expect(call.inputs.scope.default).toBe('all');
		for (const name of Object.keys(workflow.jobs)) {
			if (name === 'docker') continue;
			expect(workflow.jobs[name]!.if, name).toContain("inputs.scope != 'image'");
		}
		// The container job has no condition: it runs in both modes.
		expect(workflow.jobs['docker']!.if).toBeUndefined();
	});

	it('reports a failed browser test as a GitHub annotation, and never retries one', () => {
		// The job log needs a login to read, an annotation does not. A retry would hide a flaky test, and most tests
		// import decks with fixed ids, so a second attempt would meet the first one's data.
		const config = readFileSync('playwright.config.ts', 'utf8');
		expect(config).toMatch(/reporter: process\.env\['CI'\] \? \[\['list'\], \['github'\]\]/);
		expect(config).toContain('retries: 0');
	});

	it('can be called by the release workflow', () => {
		expect(Object.keys((parse(text) as { on: object }).on)).toContain('workflow_call');
	});

	it('builds and tests the container at the same time as the other jobs: amd64 on every push, arm64 too for the release', () => {
		const docker = workflow.jobs['docker']!;
		expect(docker.needs).toBeUndefined();
		// arm64 is built under emulation (four minutes), so only the release's image checks (scope image) include it.
		const platform = docker.strategy!.matrix.platform;
		expect(platform).toContain("inputs.scope == 'image'");
		expect(platform).toContain('["linux/amd64","linux/arm64"]');
		expect(platform).toContain('["linux/amd64"]');
		expect(commands).toContain('docker buildx build');
	});

	it('checks the container the way ADR-004 requires', () => {
		expect(commands).toContain('test "$uid" = "1000"');
		expect(commands).toContain('157286400'); // 150 MB compressed budget
		expect(commands).toContain('--read-only');
		expect(commands).toContain('--cap-drop ALL');
		expect(commands).toContain('no-new-privileges:true');
		expect(commands).toContain('scripts/smoke.ts --base http://127.0.0.1:3000');
		expect(commands).toContain('.State.Health.Status');
		expect(commands).toContain('docker stop');
		expect(commands).toContain('shutting down');
		expect(commands).toContain('"ccna-ospf"');
	});

	it('scans the built image, then fails on fixable serious findings in a step that says what they are', () => {
		const docker = workflow.jobs['docker']!;
		const names = docker.steps.map((s) => s.name ?? '');
		type WithIf = { with: Record<string, unknown>; if?: string; run?: string; name?: string };
		const scan = docker.steps.find((s) =>
			s.uses?.startsWith('aquasecurity/trivy-action@')
		) as unknown as WithIf;
		expect(scan, 'a scan step').toBeDefined();
		// It scans the image that was just built, before that image is started or trusted. The scanner writes a file
		// and does not fail on findings. It fails only if it cannot run at all, so its failure means a tool problem.
		expect(scan.with['image-ref']).toBe('tessera:ci');
		expect(scan.with['format']).toBe('json');
		expect(scan.with['output']).toBe('trivy-results.json');
		expect(scan.with['exit-code']).toBe('0');
		expect(scan.with['ignore-unfixed']).toBe(true);
		expect(scan.with['severity']).toBe('CRITICAL,HIGH');
		expect(scan.with['vuln-type']).toBe('os,library');
		// The gate is the next step. It reads that file, names each finding, and fails on serious fixable ones.
		const check = docker.steps.find((s) =>
			s.run?.includes('scripts/check-image-scan.ts')
		) as unknown as WithIf;
		expect(check, 'a check step').toBeDefined();
		expect(check.run).toBe('node scripts/check-image-scan.ts trivy-results.json');
		const order = (step: WithIf) => names.indexOf(step.name!);
		expect(order(scan)).toBeGreaterThan(names.indexOf('Build the image'));
		expect(order(check)).toBe(order(scan) + 1);
		expect(order(check)).toBeLessThan(names.findIndex((n) => n.startsWith('Start the container')));
		// One architecture is enough, and the release workflow gets it through the CI workflow it calls.
		expect(scan.if).toBe("matrix.platform == 'linux/amd64'");
		expect(check.if).toBe("matrix.platform == 'linux/amd64'");
	});

	it('publishes nothing and never logs in to a registry', () => {
		expect(text).not.toMatch(/docker\/login-action|--push|push: true|packages: write/);
	});
});

describe('Dependabot', () => {
	it('covers npm, Docker, and GitHub Actions', () => {
		expect(dependabot.updates.map((u) => u['package-ecosystem']).sort()).toEqual([
			'docker',
			'github-actions',
			'npm'
		]);
	});

	it('holds back the majors that would break the stack decisions', () => {
		const npm = dependabot.updates.find((u) => u['package-ecosystem'] === 'npm')!;
		expect(npm.ignore?.map((i) => i['dependency-name']).sort()).toEqual([
			'@types/node',
			'ts-fsrs',
			'typescript'
		]);
	});

	it('does not let a bot move the Node major of the container (ADR-004)', () => {
		const docker = dependabot.updates.find((u) => u['package-ecosystem'] === 'docker')!;
		expect(docker.ignore?.map((i) => i['dependency-name'])).toEqual(['node']);
	});

	it('updates vitest and its coverage plugin in one pull request, ahead of the general group', () => {
		const npm = dependabot.updates.find((u) => u['package-ecosystem'] === 'npm')!;
		expect(Object.keys(npm.groups ?? {})).toEqual(['vitest', 'development-tools']);
		expect(npm.groups?.['vitest']?.patterns).toEqual(['vitest', '@vitest/*']);
	});
});
