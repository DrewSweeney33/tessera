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
	updates: { 'package-ecosystem': string; ignore?: { 'dependency-name': string }[] }[];
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
		expect(npm.ignore?.map((i) => i['dependency-name']).sort()).toEqual(['ts-fsrs', 'typescript']);
	});
});
