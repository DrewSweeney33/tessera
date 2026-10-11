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
			steps: { uses?: string; run?: string; name?: string }[];
			strategy?: { matrix: { platform: string[] } };
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

	it('runs the full verify gate, audit, license check, and a server smoke test', () => {
		expect(commands).toContain('npm ci');
		expect(commands).toContain('npm run verify');
		expect(commands).toContain('npm run audit:prod');
		expect(commands).toContain('npm run licenses');
		expect(commands).toContain('npm run build');
		expect(commands).toContain('npm run smoke');
	});

	it('runs the browser tests and every check against the built server', () => {
		expect(commands).toContain('npx playwright install --with-deps chromium');
		expect(commands).toContain('npm run test:e2e');
		expect(commands).toContain('npm run benchmark');
		expect(commands).toContain('npm run security:probe');
		expect(commands).toContain('npm run durability');
		expect(commands).toContain('npm run ops:check');
	});

	it('runs the same browser tests in Firefox and WebKit, each in its own job, alongside verify', () => {
		const browsers = workflow.jobs['browsers']!;
		expect(browsers.needs).toBeUndefined();
		expect(
			(browsers.strategy as unknown as { matrix: { browser: string[] } }).matrix.browser
		).toEqual(['firefox', 'webkit']);
		const run = browsers.steps.map((step) => step.run ?? '').join('\n');
		expect(run).toContain('npm ci');
		expect(run).toContain('npm run build');
		expect(run).toContain('npx playwright install --with-deps ${{ matrix.browser }}');
		expect(run).toContain('npm run test:e2e:${{ matrix.browser }}');
		// Every browser the runner knows has a script, so the job's command exists for each.
		const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
			string,
			string
		>;
		for (const browser of ['firefox', 'webkit']) {
			expect(scripts[`test:e2e:${browser}`], browser).toBe(`node scripts/run-e2e.ts ${browser}`);
		}
		expect(text).toMatch(/browsers:[\s\S]*?timeout-minutes: 20/);
	});

	it('can be called by the release workflow', () => {
		expect(Object.keys((parse(text) as { on: object }).on)).toContain('workflow_call');
	});

	it('builds and tests the container on amd64 and arm64 after verify passes', () => {
		const docker = workflow.jobs['docker']!;
		expect(docker.needs).toBe('verify');
		expect(docker.strategy?.matrix.platform).toEqual(['linux/amd64', 'linux/arm64']);
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

	it('scans the built image for known vulnerabilities and fails on fixable serious ones', () => {
		const docker = workflow.jobs['docker']!;
		const names = docker.steps.map((s) => s.name ?? '');
		const scan = docker.steps.find((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
		expect(scan, 'a scan step').toBeDefined();
		const options = (scan as unknown as { with: Record<string, unknown>; if?: string }).with;
		// It scans the image that was just built, before that image is started or trusted.
		expect(options['image-ref']).toBe('tessera:ci');
		expect(options['exit-code']).toBe('1');
		expect(options['ignore-unfixed']).toBe(true);
		expect(options['severity']).toBe('CRITICAL,HIGH');
		expect(options['vuln-type']).toBe('os,library');
		expect(names.indexOf(scan!.name!)).toBeGreaterThan(names.indexOf('Build the image'));
		expect(names.indexOf(scan!.name!)).toBeLessThan(
			names.findIndex((n) => n.startsWith('Start the container'))
		);
		// One architecture is enough, and the release workflow gets it through the CI workflow it calls.
		expect((scan as unknown as { if?: string }).if).toBe("matrix.platform == 'linux/amd64'");
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
