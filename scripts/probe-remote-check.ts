// Checks the security probe's remote mode (the one the live-image harness uses) without needing a remote host:
// three local servers stand in for the remote ones. It proves two things, and fails if either is not true.
//   1. Given every flag, the probe runs the same checks it runs against a local build (none go missing) and
//      passes. Only "the server process is still running" is skipped, since a remote server is not a child.
//   2. Given no extra flags, the checks that need them are SKIPPED, by name, and never reported as PASS.
// Run `npm run build` first. Nothing is written outside a temporary folder.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from './lib/net.ts';
import { PROBE_ALLOWED_HOSTS, PROBE_TOKEN } from './lib/probe-config.ts';

const work = mkdtempSync(join(tmpdir(), 'tessera-probe-remote-'));
const reader = join(work, 'print-file.cjs');
writeFileSync(reader, "process.stdout.write(require('fs').readFileSync(process.argv[2], 'utf8'))");

interface Stand {
	url: string;
	log: string;
	proc: ChildProcess;
	fd: number;
}
const stands: Stand[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}

async function stand(name: string, extra: Record<string, string>): Promise<Stand> {
	const port = await freePort();
	const log = join(work, `${name}.log`);
	// Straight to a file: the probe below runs synchronously, so a pipe into this process would never drain.
	const fd = openSync(log, 'a');
	const proc = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: join(work, name),
			BODY_SIZE_LIMIT: '5M',
			LOG_LEVEL: 'debug',
			...extra
		},
		stdio: ['ignore', fd, fd]
	});
	const url = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${url}/healthz`)).ok) break;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	const made = { url, log, proc, fd };
	stands.push(made);
	return made;
}

function probe(args: string[]) {
	const run = spawnSync(process.execPath, ['scripts/security-probe.ts', ...args], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	const lines = run.stdout.split('\n');
	return {
		status: run.status,
		passed: lines.filter((l) => l.startsWith('PASS')).length,
		failed: lines.filter((l) => l.startsWith('FAIL')),
		skipped: lines.filter((l) => l.startsWith('SKIP')),
		stderr: run.stderr
	};
}

try {
	const local = probe([]);
	check(
		'the probe passes against its own local server',
		local.status === 0,
		local.failed.join('; ')
	);
	check('and skips nothing there', local.skipped.length === 0, local.skipped.join('; '));
	const total = local.passed;

	const main = await stand('main', {});
	const hosts = await stand('hosts', { TESSERA_ALLOWED_HOSTS: PROBE_ALLOWED_HOSTS });
	const token = await stand('token', { TESSERA_API_TOKEN: PROBE_TOKEN });
	const print = (s: Stand) => `node "${reader}" "${s.log}"`;

	const full = probe([
		'--base',
		main.url,
		'--hosts-base',
		hosts.url,
		'--token-base',
		token.url,
		'--logs-cmd',
		print(main),
		'--hosts-logs-cmd',
		print(hosts),
		'--token-logs-cmd',
		print(token)
	]);
	check(
		'given every flag, the remote-mode probe passes',
		full.status === 0,
		full.failed.join('; ')
	);
	check(
		'it runs every check the local mode runs (none go missing)',
		full.passed + full.skipped.length === total,
		`${full.passed} passed + ${full.skipped.length} skipped, local ran ${total}`
	);
	check(
		'it skips only the check about a local process',
		full.skipped.length === 1 && /server process is still running/.test(full.skipped[0] ?? ''),
		full.skipped.join('; ')
	);

	const bare = probe(['--base', main.url]);
	check(
		'given no extra flags, it still runs and passes what it can',
		bare.status === 0,
		bare.failed.join('; ')
	);
	for (const [label, pattern] of [
		['the log checks', /never reach the logs/],
		['the startup log check', /startup log states the host rules/],
		['the host-list checks', /host-list checks/],
		['the token checks', /API token checks/]
	] as const) {
		check(
			`it reports ${label} as SKIP, not PASS`,
			bare.skipped.some((l) => pattern.test(l)),
			bare.skipped.join('; ')
		);
	}
	check(
		'and no skipped check is also counted as passed',
		bare.passed + bare.skipped.length <= total,
		`${bare.passed} passed + ${bare.skipped.length} skipped, local ran ${total}`
	);
} catch (error) {
	console.error('\nCheck aborted:', error instanceof Error ? error.message : error);
	failures++;
} finally {
	for (const s of stands) {
		s.proc.kill();
		closeSync(s.fd);
	}
	await new Promise((r) => setTimeout(r, 400));
	rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures === 0 ? '\nNo failed checks.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
