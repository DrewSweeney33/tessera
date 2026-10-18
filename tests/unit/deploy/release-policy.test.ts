import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// The release workflow publishes software, and it cannot run on a developer machine. These tests keep
// its safety rules in place: nothing is pushed unless a tag started it, the permissions stay narrow,
// every action is pinned, and CI must pass first.
const text = readFileSync('.github/workflows/release.yml', 'utf8');
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
	on: Record<string, unknown>;
};

interface Step {
	name?: string;
	id?: string;
	if?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
}
const workflow = parse(text) as {
	on: { push?: { tags?: string[]; branches?: string[] }; workflow_dispatch?: unknown } & Record<
		string,
		unknown
	>;
	permissions: Record<string, string>;
	jobs: {
		'ci-passed': { permissions: Record<string, string>; steps: Step[] };
		image: { uses: string; with: Record<string, string> };
		publish: { needs: string[]; permissions: Record<string, string>; steps: Step[] };
	};
};
const steps = workflow.jobs.publish.steps;
const step = (match: string) => {
	const found = steps.find((s) => s.uses?.startsWith(match) || s.name?.includes(match));
	if (!found) throw new Error(`no step matching ${match}`);
	return found;
};

describe('release workflow', () => {
	it('starts only from a version tag or a manual rehearsal', () => {
		expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
		expect(workflow.on.push?.branches).toBeUndefined();
		for (const pattern of workflow.on.push?.tags ?? []) expect(pattern).toMatch(/^v\[0-9\]\+/);
		expect(workflow.on.push?.tags?.length).toBeGreaterThan(0);
	});

	it('pins every action to a full commit SHA with a version comment', () => {
		const lines = text.split('\n').filter((l) => l.includes('uses:') && !l.includes('./.github'));
		expect(lines.length).toBeGreaterThan(4);
		for (const line of lines) {
			expect(line, line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
		}
	});

	it('is read-only by default and grants write access only to the publish job', () => {
		expect(workflow.permissions).toEqual({ contents: 'read' });
		expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write', packages: 'write' });
	});

	it('publishes only if CI already passed on this exact commit and the image checks pass', () => {
		// Every push to main runs the whole CI, so the release asks GitHub whether that run succeeded on the tagged
		// commit instead of running 15 minutes of the same checks again. The image is checked again because the base
		// image can change between the push run and the release.
		expect(workflow.jobs.publish.needs.sort()).toEqual(['ci-passed', 'image']);
		expect(workflow.jobs.image.uses).toBe('./.github/workflows/ci.yml');
		expect(workflow.jobs.image.with).toEqual({ scope: 'image' });
		expect(Object.keys(ci.on)).toContain('workflow_call');
		const check = workflow.jobs['ci-passed'];
		expect(check.permissions).toEqual({ actions: 'read', contents: 'read' });
		const run = check.steps.map((s) => s.run ?? '').join('\n');
		expect(run).toContain('actions/workflows/ci.yml/runs');
		expect(run).toContain('head_sha=${GITHUB_SHA}');
		expect(run).toContain('status=success');
		expect(run).toContain('exit 1');
		// A rehearsal publishes nothing, so only a tag has to answer the question.
		expect(check.steps.some((s) => s['if'] === "github.ref_type == 'tag'")).toBe(true);
	});

	it('refuses a tag that does not match package.json or a version missing from the changelog', () => {
		const run = step('Read the version').run ?? '';
		expect(run).toContain('package.json');
		expect(run).toContain('GITHUB_REF_NAME');
		expect(run).toContain('CHANGELOG.md');
		expect(run).toContain('exit 1');
	});

	it('pushes the image, logs in, and creates the release only for a tag', () => {
		expect(step('Log in').if).toBe("github.ref_type == 'tag'");
		expect(step('Create the GitHub release').if).toBe("github.ref_type == 'tag'");
		const build = step('docker/build-push-action');
		expect(build.with?.['push']).toBe("${{ github.ref_type == 'tag' }}");
	});

	it('builds both architectures with provenance and an SBOM', () => {
		const build = step('docker/build-push-action');
		expect(build.with?.['platforms']).toBe('linux/amd64,linux/arm64');
		expect(build.with?.['provenance']).toBe('mode=max');
		expect(build.with?.['sbom']).toBe(true);
	});

	it('gives release candidates only their exact tag, and stable versions latest', () => {
		const meta = step('docker/metadata-action');
		const tags = String(meta.with?.['tags']);
		expect(tags).toContain('type=semver,pattern={{version}}');
		expect(tags).toMatch(
			/pattern=\{\{major\}\}\.\{\{minor\}\},enable=.*contains\(github\.ref_name, '-'\)/
		);
		expect(meta.with?.['flavor']).toBe('latest=auto');
	});

	it('marks versions with a suffix as pre-releases', () => {
		expect(step('Create the GitHub release').run).toContain('--prerelease');
	});

	it('exposes the token only to the step that needs it', () => {
		const withToken = steps.filter((s) => s.env && 'GH_TOKEN' in s.env).map((s) => s.name);
		expect(withToken).toEqual(['Create the GitHub release']);
	});

	it('never runs on pull requests', () => {
		expect(text).not.toContain('pull_request');
	});
});
