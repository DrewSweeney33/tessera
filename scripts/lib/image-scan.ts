// The logic of scripts/check-image-scan.ts, kept apart so it can be tested without running the command.
import { existsSync, readFileSync } from 'node:fs';

export interface Vulnerability {
	VulnerabilityID?: string | undefined;
	PkgName?: string | undefined;
	InstalledVersion?: string | undefined;
	FixedVersion?: string | undefined;
	Severity?: string | undefined;
	Title?: string | undefined;
	PrimaryURL?: string | undefined;
}
export interface ScanResult {
	Target?: string;
	Class?: string;
	Type?: string;
	Vulnerabilities?: Vulnerability[] | null;
}
export interface Report {
	ArtifactName?: string;
	Metadata?: { OS?: { Family?: string; Name?: string } };
	Results?: ScanResult[] | null;
}

const SERIOUS = new Set(['HIGH', 'CRITICAL']);
const MAX_ANNOTATIONS = 10;

export interface Finding {
	id: string;
	severity: string;
	package: string;
	installed: string;
	fixed: string;
	target: string;
	title: string;
	url: string;
}

// The findings that fail the build: serious, and with a fixed version that exists.
export function seriousFixableFindings(report: Report): Finding[] {
	const found: Finding[] = [];
	for (const result of report.Results ?? []) {
		for (const vulnerability of result.Vulnerabilities ?? []) {
			const severity = (vulnerability.Severity ?? '').toUpperCase();
			const fixed = vulnerability.FixedVersion ?? '';
			if (!SERIOUS.has(severity) || fixed === '') continue;
			found.push({
				id: vulnerability.VulnerabilityID ?? '(no id)',
				severity,
				package: vulnerability.PkgName ?? '(no package)',
				installed: vulnerability.InstalledVersion ?? '?',
				fixed,
				target: result.Target ?? '',
				title: (vulnerability.Title ?? '').slice(0, 120),
				url: vulnerability.PrimaryURL ?? ''
			});
		}
	}
	// Critical first, then by package, so the annotation limit shows the worst.
	return found.sort(
		(a, b) =>
			Number(b.severity === 'CRITICAL') - Number(a.severity === 'CRITICAL') ||
			a.package.localeCompare(b.package) ||
			a.id.localeCompare(b.id)
	);
}

// What was looked at, so a pass is not an empty scan.
export function describeScope(report: Report): string {
	const results = report.Results ?? [];
	const os = report.Metadata?.OS;
	const targets = results.map((r) => `${r.Target ?? '?'} (${r.Class ?? '?'})`);
	return `${report.ArtifactName ?? 'image'}${os ? `, ${os.Family} ${os.Name}` : ''}: ${results.length} target${results.length === 1 ? '' : 's'} scanned${targets.length ? ` (${targets.join('; ')})` : ''}`;
}

function escapeData(text: string): string {
	return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

// Fails with a message the person can act on. Returns the process exit code.
export function check(path: string): number {
	if (!existsSync(path)) {
		console.error(
			`::error title=Image scan::${escapeData(`No scan result at ${path}. The scan step did not write one.`)}`
		);
		return 1;
	}
	let report: Report;
	try {
		report = JSON.parse(readFileSync(path, 'utf8')) as Report;
	} catch (error) {
		console.error(
			`::error title=Image scan::${escapeData(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`)}`
		);
		return 1;
	}

	const scope = describeScope(report);
	if ((report.Results ?? []).length === 0) {
		console.error(
			`::error title=Image scan::${escapeData(`The scan looked at nothing. ${scope}`)}`
		);
		return 1;
	}

	const findings = seriousFixableFindings(report);
	console.log(scope);
	if (findings.length === 0) {
		console.log('No high or critical vulnerability with a fix available.');
		console.log(
			`::notice title=Image scan::${escapeData(`No fixable high or critical vulnerabilities. ${scope}`)}`
		);
		return 0;
	}

	console.log(
		`${findings.length} high or critical vulnerabilit${findings.length === 1 ? 'y' : 'ies'} with a fix available:\n`
	);
	for (const finding of findings) {
		console.log(
			`${finding.severity.padEnd(8)} ${finding.id.padEnd(18)} ${finding.package} ${finding.installed} -> ${finding.fixed}  [${finding.target}]\n         ${finding.title} ${finding.url}`
		);
	}
	for (const finding of findings.slice(0, MAX_ANNOTATIONS)) {
		const message =
			`${finding.package} ${finding.installed} should be ${finding.fixed} or newer. ${finding.title} ${finding.url}`.trim();
		console.error(
			`::error title=${escapeData(`${finding.severity} ${finding.id}`)}::${escapeData(message)}`
		);
	}
	if (findings.length > MAX_ANNOTATIONS) {
		console.error(
			`::error title=Image scan::${escapeData(`${findings.length - MAX_ANNOTATIONS} more not shown. ${scope}`)}`
		);
	}
	console.error(
		'\nFix: for an operating system package, rebuild on the newest base image. For an npm package, update the dependency.'
	);
	return 1;
}

if (
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop()!)
) {
	process.exit(check(process.argv[2] ?? 'trivy-results.json'));
}
