import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	describeScope,
	seriousFixableFindings,
	type Report,
	type Vulnerability
} from '../../../scripts/lib/image-scan.ts';

// The image scan gate reads Trivy's JSON result. Its job is to fail on serious findings that can be fixed, to say
// exactly what they are (in the log and as GitHub annotations, because the job log cannot be read without logging
// in), and never to pass because a scan looked at nothing.

const vulnerability = (overrides: Vulnerability = {}): Vulnerability => ({
	VulnerabilityID: 'CVE-2026-0001',
	PkgName: 'libexample',
	InstalledVersion: '1.0.0',
	FixedVersion: '1.0.1',
	Severity: 'HIGH',
	Title: 'A flaw in libexample',
	PrimaryURL: 'https://avd.aquasec.com/nvd/cve-2026-0001',
	...overrides
});

const report = (vulnerabilities: Vulnerability[] | null = [vulnerability()]): Report => ({
	ArtifactName: 'tessera:ci',
	Metadata: { OS: { Family: 'debian', Name: '13.1' } },
	Results: [
		{
			Target: 'tessera:ci (debian 13.1)',
			Class: 'os-pkgs',
			Type: 'debian',
			Vulnerabilities: vulnerabilities
		},
		{ Target: 'app/package-lock.json', Class: 'lang-pkgs', Type: 'npm' }
	]
});

describe('seriousFixableFindings', () => {
	it('keeps high and critical findings that have a fix', () => {
		const found = seriousFixableFindings(
			report([
				vulnerability(),
				vulnerability({ VulnerabilityID: 'CVE-2026-0002', Severity: 'CRITICAL', PkgName: 'zlib' })
			])
		);
		expect(found.map((f) => f.id)).toEqual(['CVE-2026-0002', 'CVE-2026-0001']);
	});

	it.each(['MEDIUM', 'LOW', 'UNKNOWN', '', 'INFO'])('ignores severity %j', (severity) => {
		expect(seriousFixableFindings(report([vulnerability({ Severity: severity })]))).toEqual([]);
	});

	it('ignores a finding with no fix, since nothing can be done about it yet', () => {
		expect(seriousFixableFindings(report([vulnerability({ FixedVersion: '' })]))).toEqual([]);
		expect(seriousFixableFindings(report([vulnerability({ FixedVersion: undefined })]))).toEqual(
			[]
		);
	});

	it('reads the severity in any case', () => {
		expect(seriousFixableFindings(report([vulnerability({ Severity: 'high' })]))).toHaveLength(1);
	});

	it('copes with a result that has no vulnerabilities, a null list, and no results at all', () => {
		expect(seriousFixableFindings(report(null))).toEqual([]);
		expect(
			seriousFixableFindings({ Results: [{ Target: 'x', Class: 'os-pkgs', Type: 'debian' }] })
		).toEqual([]);
		expect(seriousFixableFindings({})).toEqual([]);
		expect(seriousFixableFindings({ Results: null })).toEqual([]);
	});

	it('sorts critical first, then by package, so a limit on annotations shows the worst', () => {
		const found = seriousFixableFindings(
			report([
				vulnerability({ VulnerabilityID: 'CVE-3', PkgName: 'b' }),
				vulnerability({ VulnerabilityID: 'CVE-1', PkgName: 'a' }),
				vulnerability({ VulnerabilityID: 'CVE-2', PkgName: 'z', Severity: 'CRITICAL' })
			])
		);
		expect(found.map((f) => f.id)).toEqual(['CVE-2', 'CVE-1', 'CVE-3']);
	});

	it('keeps what a person needs to act on it', () => {
		expect(seriousFixableFindings(report())[0]).toEqual({
			id: 'CVE-2026-0001',
			severity: 'HIGH',
			package: 'libexample',
			installed: '1.0.0',
			fixed: '1.0.1',
			target: 'tessera:ci (debian 13.1)',
			title: 'A flaw in libexample',
			url: 'https://avd.aquasec.com/nvd/cve-2026-0001'
		});
	});
});

describe('describeScope', () => {
	it('says what was scanned, so a pass shows something was looked at', () => {
		const text = describeScope(report());
		expect(text).toContain('tessera:ci, debian 13.1');
		expect(text).toContain('2 targets scanned');
		expect(text).toContain('tessera:ci (debian 13.1) (os-pkgs)');
		expect(text).toContain('app/package-lock.json (lang-pkgs)');
	});

	it('copes with an empty report', () => {
		expect(describeScope({})).toBe('image: 0 targets scanned');
	});
});

describe('the command', () => {
	const folders: string[] = [];
	afterEach(() => {
		for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
	});

	function run(content: string | undefined) {
		const folder = mkdtempSync(join(tmpdir(), 'tessera-scan-'));
		folders.push(folder);
		const path = join(folder, 'trivy-results.json');
		if (content !== undefined) writeFileSync(path, content);
		const result = spawnSync(process.execPath, ['scripts/check-image-scan.ts', path], {
			encoding: 'utf8'
		});
		return { status: result.status, stdout: result.stdout, stderr: result.stderr };
	}

	it('passes a clean result, and says what it looked at', () => {
		const result = run(JSON.stringify(report([])));
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('No high or critical vulnerability with a fix available.');
		expect(result.stdout).toContain('::notice title=Image scan::');
		expect(result.stdout).toContain('2 targets scanned');
	});

	it('passes when the only findings are minor or have no fix', () => {
		const result = run(
			JSON.stringify(
				report([vulnerability({ Severity: 'MEDIUM' }), vulnerability({ FixedVersion: '' })])
			)
		);
		expect(result.status).toBe(0);
	});

	it('fails on a fixable serious finding and names it in the log and as an annotation', () => {
		const result = run(JSON.stringify(report()));
		expect(result.status).toBe(1);
		expect(result.stdout).toContain('HIGH');
		expect(result.stdout).toContain('CVE-2026-0001');
		expect(result.stdout).toContain('libexample 1.0.0 -> 1.0.1');
		expect(result.stderr).toContain(
			'::error title=HIGH CVE-2026-0001::libexample 1.0.0 should be 1.0.1 or newer.'
		);
		expect(result.stderr).toContain('rebuild on the newest base image');
	});

	it('writes at most ten annotations and says how many more there were', () => {
		const many = Array.from({ length: 14 }, (_, i) =>
			vulnerability({
				VulnerabilityID: `CVE-2026-${1000 + i}`,
				PkgName: `pkg${String(i).padStart(2, '0')}`
			})
		);
		const result = run(JSON.stringify(report(many)));
		expect(result.status).toBe(1);
		expect(result.stderr.match(/::error title=HIGH /g)).toHaveLength(10);
		expect(result.stderr).toContain('4 more not shown');
		// The log still lists all of them.
		expect(result.stdout.match(/CVE-2026-10\d\d/g)).toHaveLength(14);
	});

	it('keeps line breaks and percent signs in a title from breaking the annotation', () => {
		const result = run(JSON.stringify(report([vulnerability({ Title: '100% bad\nsecond line' })])));
		const line = result.stderr.split('\n').find((l) => l.startsWith('::error title=HIGH'))!;
		expect(line).toContain('100%25 bad');
		expect(line).not.toContain('second line\n');
		expect(line).toContain('%0Asecond line');
	});

	it('fails, and says so, when the scan wrote no file', () => {
		const result = run(undefined);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No scan result');
	});

	it('fails on a file that is not JSON', () => {
		const result = run('Error: could not download the database');
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('is not valid JSON');
	});

	it.each([JSON.stringify({}), JSON.stringify({ Results: null }), JSON.stringify({ Results: [] })])(
		'fails on a scan that looked at nothing: %s',
		(content) => {
			const result = run(content);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain('looked at nothing');
		}
	);
});
