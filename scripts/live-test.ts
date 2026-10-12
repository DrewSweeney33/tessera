// The live-image harness (ADR-012). Runs the real Tessera image on a real Docker host over SSH, as a throwaway
// test instance, and checks it: container hardening, the application tests, backup and restore, a hard kill
// and a graceful stop, a full disk, and (optionally) a soak. It never touches the live instance.
//
//   TESSERA_LIVE_SSH=andrew@192.168.30.102 node scripts/live-test.ts [options]
//
//   --target user@host    the Docker host over SSH (or TESSERA_LIVE_SSH). Key login only, no password prompt.
//   --image REF           the image to test (default: ghcr.io/drewsweeney33/tessera:<version in package.json>)
//   --build               instead, build the image from the committed HEAD on the host and test that one
//   --port N              base port, five consecutive ports are used (default 3001)
//   --live-port N         the live instance's port, which must not be used (default 3000)
//   --live-dir PATH       the live instance's folder, only to compare its image with the one under test
//   --soak MINUTES        also run a sustained load for this long (default: none)
//   --dry-run             print the plan and the generated compose file, change nothing
//
// Everything it creates is in /opt/tessera-test and the compose project "tessera-test", and is removed at the end,
// and at the start of the next run if this one was cut short. Run `docs/testing-on-your-host.md` for the details.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MARKER_FILE,
	TEST_DIR,
	TEST_NAME,
	assertSafe,
	buildCompose,
	composeCommand,
	extractGuideCommands,
	layoutFor,
	parseSshTarget,
	setupCommand,
	sshArgs,
	teardownCommand,
	type Layout,
	type SshTarget
} from './lib/live-test.ts';
import { PROBE_TOKEN } from './lib/probe-config.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
	args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const has = (name: string): boolean => args.includes(name);

const version = (
	JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
).version;
const dryRun = has('--dry-run');
const buildHere = has('--build');
const basePort = Number(flag('--port') ?? 3001);
const livePort = Number(flag('--live-port') ?? 3000);
const liveDir = flag('--live-dir');
const soakMinutes = Number(flag('--soak') ?? 0);
const candidate = 'tessera-test:candidate';
const image = buildHere
	? candidate
	: (flag('--image') ?? `ghcr.io/drewsweeney33/tessera:${version}`);

let failures = 0;
let skipped = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): boolean {
	console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (ok) passed++;
	else failures++;
	return ok;
}
function skip(name: string, reason: string): void {
	console.log(`SKIP  ${name}  (${reason})`);
	skipped++;
}
function heading(text: string): void {
	console.log(`\n# ${text}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const targetText = flag('--target') ?? process.env['TESSERA_LIVE_SSH'] ?? '';
let target: SshTarget;
try {
	target = parseSshTarget(targetText);
	assertSafe({ basePort, livePort, ...(liveDir === undefined ? {} : { liveDir }) });
} catch (error) {
	console.error(`Refusing to run: ${error instanceof Error ? error.message : error}`);
	process.exit(2);
}
const ports: Layout = layoutFor(basePort);
const bindHost = flag('--bind-host') ?? target.host;
const url = (service: keyof Layout) => `http://${bindHost}:${ports[service]}`;

// What this script reads from the server's JSON answers.
interface Item {
	cardPk: number;
	ordinal: number;
	servedAt: string;
}
interface DeckRow {
	id: string;
	title: string;
	cardCount: number;
	createdAt: string;
	updatedAt: string;
}
interface Body {
	ok?: boolean;
	version?: string;
	decks?: DeckRow[];
	item?: Item;
	result?: { replayed?: boolean };
}
// What this script reads from `docker inspect`.
interface Inspect {
	Config?: { User?: string };
	HostConfig?: {
		ReadonlyRootfs?: boolean;
		CapDrop?: string[];
		SecurityOpt?: string[];
		Memory?: number;
		RestartPolicy?: { Name?: string };
		LogConfig?: { Config?: Record<string, string> };
		PortBindings?: unknown;
	};
}

interface Reply {
	status: number;
	stdout: string;
	stderr: string;
}
// Runs one command on the Docker host. The command string is built by scripts/lib/live-test.ts or from fixed
// text here; nothing from the outside reaches it.
function remote(
	command: string,
	options: { input?: string | Buffer; timeoutMs?: number } = {}
): Reply {
	const run = spawnSync('ssh', [...sshArgs(target), command], {
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		timeout: options.timeoutMs ?? 120_000,
		...(options.input === undefined ? {} : { input: options.input })
	});
	return { status: run.status ?? 255, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

const composeText = buildCompose({
	image,
	bindHost,
	ports,
	repoCompose: readFileSync(join(root, 'compose.yaml'), 'utf8')
});

if (dryRun) {
	console.log(`Plan (nothing is changed)\n`);
	console.log(`target        ${target.user}@${target.host}`);
	console.log(
		`image         ${image}${buildHere ? '  (built on the host from the committed HEAD)' : ''}`
	);
	console.log(`folder        ${TEST_DIR}  (marker ${MARKER_FILE}), project ${TEST_NAME}`);
	console.log(
		`ports         ${Object.entries(ports)
			.map(([n, p]) => `${n} ${p}`)
			.join(', ')}  (live ${livePort} is not used)`
	);
	console.log(`soak          ${soakMinutes > 0 ? `${soakMinutes} minutes` : 'none'}\n`);
	console.log(
		'Steps: start, hardening, application tests, backup and restore, kill and stop, full disk, soak, teardown\n'
	);
	console.log(`setup:     ${setupCommand()}`);
	console.log(`teardown:  ${teardownCommand()}\n`);
	console.log('compose.yaml that would be written:\n');
	console.log(composeText);
	process.exit(0);
}

const compose = (rest: string, options?: { input?: string | Buffer; timeoutMs?: number }) =>
	remote(composeCommand(rest), options);
const containerId = (service: string) => compose(`ps -q ${service}`).stdout.trim();

async function waitHealthy(service: string, seconds = 120): Promise<boolean> {
	const id = containerId(service);
	if (!id) return false;
	for (let i = 0; i < seconds / 2; i++) {
		const state = remote(`docker inspect --format '{{.State.Health.Status}}' ${id}`).stdout.trim();
		if (state === 'healthy') return true;
		await sleep(2000);
	}
	return false;
}

async function http(base: string, path: string, init: RequestInit = {}) {
	try {
		const response = await fetch(`${base}${path}`, init);
		const text = await response.text();
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			body = undefined;
		}
		return { status: response.status, text, body: body as Body | undefined };
	} catch (error) {
		return { status: 0, text: String(error), body: undefined };
	}
}
const postJson = (base: string, path: string, payload: unknown) =>
	http(base, path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});

function deck(id: string, count: number, size = 20) {
	return {
		tessera: 1,
		deck: { id, title: id },
		cards: Array.from({ length: count }, (_, i) => ({
			id: `c${i}`,
			type: 'basic',
			front: `Question ${i} of ${id}`,
			back: `Answer ${i} ${'x'.repeat(size)}`
		}))
	};
}

// A local run of one of the repository's scripts against the test instance.
function runLocal(script: string, scriptArgs: string[]) {
	const run = spawnSync(process.execPath, [join('scripts', script), ...scriptArgs], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		timeout: 20 * 60_000
	});
	return { status: run.status ?? 1, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}
const tail = (text: string, lines = 4) => text.trim().split('\n').slice(-lines).join('\n');

const started = Date.now();
let installedCandidate = false;

async function main(): Promise<void> {
	// ---- 0. Preflight and a clean start
	heading('Preflight');
	const pre = remote('docker --version && docker compose version');
	if (
		!check(
			'the host answers over ssh and has docker and compose',
			pre.status === 0,
			pre.stderr.trim()
		)
	)
		throw new Error('cannot reach the Docker host');
	remote(teardownCommand(), { timeoutMs: 180_000 });
	const listening = remote('ss -ltn').stdout;
	const busy = Object.values(ports).filter((p) => new RegExp(`:${p}\\s`).test(listening));
	if (
		!check(
			'the five test ports are free on the host',
			busy.length === 0,
			`in use: ${busy.join(', ')}`
		)
	)
		throw new Error('a test port is in use');
	check('the live port is not among them', !Object.values(ports).includes(livePort));

	// ---- 1. Start
	heading('Start the test instance');
	check('the test folder was created', remote(setupCommand()).status === 0);
	if (buildHere) {
		const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
			cwd: root,
			maxBuffer: 512 * 1024 * 1024
		});
		const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
			cwd: root,
			encoding: 'utf8'
		}).stdout.trim();
		console.log(
			`building ${candidate} on the host from commit ${sha} (${Math.round(archive.stdout.length / 1024)} KB)`
		);
		const build = remote(
			`docker build --build-arg VERSION=${version} --build-arg REVISION=${sha} -t ${candidate} -`,
			{
				input: archive.stdout,
				timeoutMs: 30 * 60_000
			}
		);
		installedCandidate = true;
		check('the image was built on the host', build.status === 0, tail(build.stderr, 3));
		if (build.status !== 0) throw new Error('build failed');
	}
	const written = remote(`cat > ${TEST_DIR}/compose.yaml`, { input: composeText });
	check('compose.yaml was written', written.status === 0, written.stderr.trim());
	if (!buildHere) {
		const pull = compose('pull main', { timeoutMs: 10 * 60_000 });
		check(`the image ${image} was pulled`, pull.status === 0, tail(pull.stderr, 3));
		if (pull.status !== 0) throw new Error('pull failed');
	}
	const up = compose('up -d main hosts token', { timeoutMs: 5 * 60_000 });
	check('the main, hosts, and token services started', up.status === 0, tail(up.stderr, 3));
	for (const service of ['main', 'hosts', 'token']) {
		check(`${service} reports healthy`, await waitHealthy(service));
	}
	const health = await http(url('main'), '/healthz');
	check(
		'/healthz answers from this machine over the network',
		health.status === 200 && health.body?.['ok'] === true,
		health.text.slice(0, 80)
	);
	check(
		`and reports version ${version}`,
		health.body?.['version'] === version,
		String(health.body?.['version'])
	);
	if (liveDir) {
		const liveImage = remote(
			`docker inspect --format '{{.Image}}' $(docker compose -f ${liveDir}/compose.yaml ps -q | head -1)`
		).stdout.trim();
		const testImage = remote(`docker image inspect --format '{{.Id}}' ${image}`).stdout.trim();
		console.log(
			`INFO  image under test ${testImage.slice(0, 19)}, live instance ${liveImage.slice(0, 19)}  (${liveImage === testImage ? 'the same image' : 'different images'})`
		);
	}

	// ---- 2. Hardening, as Docker applies it on this host
	heading('Container hardening on this host');
	const id = containerId('main');
	const inspected = JSON.parse(remote(`docker inspect ${id}`).stdout || '[]')[0] as
		Inspect | undefined;
	if (!inspected) {
		check('the container could be inspected', false);
	} else {
		check(
			'it runs as a non-root user',
			inspected['Config']?.['User'] === 'node' || inspected['Config']?.['User'] === '1000',
			String(inspected['Config']?.['User'])
		);
		check('its root filesystem is read-only', inspected['HostConfig']?.['ReadonlyRootfs'] === true);
		check(
			'all Linux capabilities are dropped',
			(inspected['HostConfig']?.['CapDrop'] ?? []).includes('ALL'),
			JSON.stringify(inspected['HostConfig']?.['CapDrop'])
		);
		check(
			'no-new-privileges is set',
			(inspected['HostConfig']?.['SecurityOpt'] ?? []).includes('no-new-privileges:true'),
			JSON.stringify(inspected['HostConfig']?.['SecurityOpt'])
		);
		check(
			'the memory limit is 512 MB',
			inspected['HostConfig']?.['Memory'] === 512 * 1024 * 1024,
			String(inspected['HostConfig']?.['Memory'])
		);
		check(
			'it restarts unless stopped',
			inspected['HostConfig']?.['RestartPolicy']?.['Name'] === 'unless-stopped'
		);
		check(
			'its logs rotate (10 MB, 3 files)',
			inspected['HostConfig']?.['LogConfig']?.['Config']?.['max-size'] === '10m' &&
				inspected['HostConfig']?.['LogConfig']?.['Config']?.['max-file'] === '3'
		);
		check(
			'it publishes only the test port, on the host address',
			JSON.stringify(inspected['HostConfig']?.['PortBindings']).includes(String(ports.main)) &&
				!JSON.stringify(inspected['HostConfig']?.['PortBindings']).includes(`"${livePort}"`)
		);
	}
	const uid = remote(`docker exec ${id} id -u`).stdout.trim();
	check('the server process is user 1000 inside', uid === '1000', uid);
	const writeRoot = remote(
		`docker exec ${id} sh -c 'touch /probe-root 2>/dev/null && echo wrote || echo blocked'`
	).stdout.trim();
	check('writing to the root filesystem is refused', writeRoot === 'blocked', writeRoot);
	const writeData = remote(
		`docker exec ${id} sh -c 'touch /data/probe-data && rm /data/probe-data && echo ok'`
	).stdout.trim();
	check('writing to /data works', writeData === 'ok', writeData);
	check(
		'/data/backups exists on a fresh install',
		remote(`docker exec ${id} test -d /data/backups`).status === 0
	);

	// ---- 3. The application tests, from this machine over the network
	heading('Application tests (smoke, security probe, benchmark) over the network');
	const smoke = runLocal('smoke.ts', ['--base', url('main')]);
	check('smoke test passes', smoke.status === 0, tail(smoke.out));
	const logsCmd = (service: string) =>
		`ssh ${sshArgs(target).join(' ')} "${composeCommand(`logs --no-log-prefix ${service}`)}"`;
	const probe = runLocal('security-probe.ts', [
		'--base',
		url('main'),
		'--hosts-base',
		url('hosts'),
		'--token-base',
		url('token'),
		'--logs-cmd',
		logsCmd('main'),
		'--hosts-logs-cmd',
		logsCmd('hosts'),
		'--token-logs-cmd',
		logsCmd('token')
	]);
	const probeLines = probe.out.split('\n');
	const probePassed = probeLines.filter((l) => l.startsWith('PASS')).length;
	const probeSkipped = probeLines.filter((l) => l.startsWith('SKIP'));
	check(
		`security probe passes (${probePassed} checks)`,
		probe.status === 0,
		probeLines
			.filter((l) => l.startsWith('FAIL'))
			.slice(0, 3)
			.join('; ') || tail(probe.out)
	);
	if (probeSkipped.length > 0) {
		for (const line of probeSkipped) skip(line.replace(/^SKIP\s+/, ''), 'reported by the probe');
	}
	const bench = runLocal('benchmark.ts', ['--base', url('main')]);
	check('benchmark stays within its budget over the network', bench.status === 0, tail(bench.out));
	console.log(
		tail(bench.out, 9)
			.split('\n')
			.map((l) => `      ${l}`)
			.join('\n')
	);

	// ---- 4. Backup and restore, with the commands from the operations guide
	heading('Backup and restore, as the operations guide prints them');
	const guide = extractGuideCommands(readFileSync(join(root, 'docs', 'operations.md'), 'utf8'));
	remote(`mkdir -p ${TEST_DIR}/out`);
	const backup = compose(
		`exec -T main node -e "${guide.backupScript}" /data/tessera.db /data/backups/live-test.db`
	);
	check('the documented backup command works', backup.status === 0, tail(backup.stderr, 2));
	const sound = compose(`exec -T main node -e "${guide.checkScript}" /data/backups/live-test.db`);
	check(
		'and the documented integrity check prints ok',
		sound.stdout.trim() === 'ok',
		sound.stdout.trim() || tail(sound.stderr, 2)
	);
	const copied = compose(`cp main:/data/backups/. ${TEST_DIR}/out/`);
	check(
		'the backup was copied out of the container',
		copied.status === 0 && remote(`test -s ${TEST_DIR}/out/live-test.db`).status === 0,
		tail(copied.stderr, 2)
	);
	const restore = compose(
		`run --rm --no-deps -v ${TEST_DIR}/out:/b:ro --entrypoint sh restored -c "cp /b/live-test.db /data/tessera.db"`
	);
	check(
		'the backup was put in place in a fresh volume',
		restore.status === 0,
		tail(restore.stderr, 2)
	);
	compose('up -d restored');
	check('a second instance on the restored data is healthy', await waitHealthy('restored'));
	const before = await http(url('main'), '/api/decks');
	const after = await http(url('restored'), '/api/decks');
	const summary = (r: { body?: Body | undefined }) =>
		JSON.stringify(
			(r.body?.['decks'] ?? [])
				.map((d: DeckRow) => [d.id, d.title, d.cardCount, d.createdAt, d.updatedAt])
				.sort()
		);
	check(
		`the restored instance holds the same decks and card counts (${(before.body?.['decks'] ?? []).length} decks)`,
		before.status === 200 &&
			after.status === 200 &&
			summary(before) === summary(after) &&
			(before.body?.['decks'] ?? []).length > 0,
		`${before.status} / ${after.status}`
	);

	// ---- 5. A hard kill, then a graceful stop
	heading('A hard kill after a saved grade, and a graceful stop');
	await postJson(url('main'), '/api/import', deck('live-keep', 3));
	const next = await http(url('main'), '/api/study/next?deckId=live-keep');
	const item = next.body?.['item'];
	const review = (servedAt: string) => ({
		reviewId: 'live-killed-after-ack',
		cardPk: item?.cardPk,
		ordinal: item?.ordinal,
		grade: 4,
		servedAt,
		deckId: 'live-keep'
	});
	const saved = await postJson(url('main'), '/api/study/review', review(item?.servedAt ?? ''));
	check('a grade was acknowledged', saved.status === 200, saved.text.slice(0, 100));
	const restartsBefore = Number(
		remote(`docker inspect --format '{{.RestartCount}}' ${id}`).stdout.trim()
	);
	remote(`docker kill -s KILL ${id}`);
	let restarted = false;
	for (let i = 0; i < 40 && !restarted; i++) {
		await sleep(1500);
		const state = remote(
			`docker inspect --format '{{.RestartCount}} {{.State.Health.Status}}' ${id}`
		)
			.stdout.trim()
			.split(' ');
		restarted = Number(state[0]) > restartsBefore && state[1] === 'healthy';
	}
	check('Docker restarted the killed container and it became healthy', restarted);
	const replayed = await postJson(
		url('main'),
		'/api/study/review',
		review(new Date().toISOString())
	);
	check(
		'the acknowledged grade survived the kill (replayed)',
		replayed.body?.['result']?.['replayed'] === true,
		replayed.text.slice(0, 100)
	);
	const stopStart = Date.now();
	remote(`docker stop -t 20 ${id}`, { timeoutMs: 60_000 });
	const stopSeconds = (Date.now() - stopStart) / 1000;
	const exit = remote(`docker inspect --format '{{.State.ExitCode}}' ${id}`).stdout.trim();
	check('a graceful stop exits cleanly (code 0)', exit === '0', `exit ${exit}`);
	check('and does not wait for the kill timeout', stopSeconds < 15, `${stopSeconds.toFixed(1)} s`);
	check(
		'the shutdown was logged',
		remote(`docker logs --tail 40 ${id} 2>&1`).stdout.includes('shutting down')
	);
	remote(`docker start ${id}`);
	check('it started again and is healthy', await waitHealthy('main'));
	const again = await postJson(url('main'), '/api/study/review', review(new Date().toISOString()));
	check('the grade survived the stop too', again.body?.['result']?.['replayed'] === true);

	// ---- 6. A full disk (a small memory-backed volume, never the host's disk)
	heading('A full disk, on an 8 MB memory-backed volume');
	const tinyUp = compose('up -d tiny');
	if (tinyUp.status !== 0 || !(await waitHealthy('tiny'))) {
		skip(
			'the full-disk checks',
			`the small volume could not be started: ${tail(tinyUp.stderr, 2)}`
		);
	} else {
		const tinyId = containerId('tiny');
		const fill = remote(
			`docker exec ${tinyId} sh -c 'dd if=/dev/zero of=/data/filler bs=1M count=5 2>&1 | tail -1'`
		);
		check(
			'a 5 MB filler file was written to the small volume',
			fill.status === 0,
			fill.stderr.trim()
		);
		let firstError: { status: number; text: string } | undefined;
		for (let i = 0; i < 14 && !firstError; i++) {
			const result = await postJson(url('tiny'), '/api/import', deck(`full-${i}`, 1200, 300));
			if (result.status !== 200) firstError = result;
		}
		check('imports eventually fail when the volume is full', firstError !== undefined);
		check(
			'with an answer, not a dropped connection',
			(firstError?.status ?? 0) >= 400,
			String(firstError?.status)
		);
		check(
			'the answer says what happened',
			/disk|space|full|write|database|storage/i.test(firstError?.text ?? ''),
			(firstError?.text ?? '').slice(0, 140)
		);
		const running = remote(
			`docker inspect --format '{{.State.Running}} {{.RestartCount}}' ${tinyId}`
		).stdout.trim();
		check('the container did not crash or restart', running === 'true 0', running);
		check(
			'reads still work while the volume is full',
			(await http(url('tiny'), '/api/decks')).status === 200
		);
		remote(`docker exec ${tinyId} rm -f /data/filler`);
		const recovered = await postJson(url('tiny'), '/api/import', deck('after-full', 5));
		check(
			'imports work again once space is freed',
			recovered.status === 200,
			`${recovered.status} ${recovered.text.slice(0, 100)}`
		);
		const integrity = compose(`exec -T tiny node -e "${guide.checkScript}" /data/tessera.db`);
		check(
			'the database is intact after all that (integrity check ok)',
			integrity.stdout.trim() === 'ok',
			integrity.stdout.trim() || tail(integrity.stderr, 2)
		);
	}

	// ---- 7. Soak
	heading('Soak');
	if (soakMinutes > 0) await soak(soakMinutes);
	else skip('the soak', 'not requested (--soak MINUTES)');
}

async function soak(minutes: number): Promise<void> {
	await postJson(url('main'), '/api/import', deck('live-soak', 500));
	const id = containerId('main');
	const memory = () => {
		const text = remote(`docker stats --no-stream --format '{{.MemUsage}}' ${id}`).stdout.trim();
		const match = /([\d.]+)(MiB|GiB|KiB)/.exec(text);
		if (!match) return NaN;
		return Number(match[1]) * (match[2] === 'GiB' ? 1024 : match[2] === 'KiB' ? 1 / 1024 : 1);
	};
	const stats = { ok: 0, odd: {} as Record<string, number>, loops: 0 };
	const end = Date.now() + minutes * 60_000;
	const samples: number[] = [];
	const sampler = (async () => {
		while (Date.now() < end) {
			samples.push(memory());
			await sleep(30_000);
		}
	})();
	const worker = async (workerId: number) => {
		let n = 0;
		while (Date.now() < end) {
			n++;
			stats.loops++;
			const next = await http(url('main'), '/api/study/next?deckId=live-soak');
			const note = (status: number) => {
				if (status >= 200 && status < 300) stats.ok++;
				else if (status !== 409 && status !== 422)
					stats.odd[String(status)] = (stats.odd[String(status)] ?? 0) + 1;
			};
			note(next.status);
			const item = next.body?.['item'];
			if (item) {
				const r = await postJson(url('main'), '/api/study/review', {
					reviewId: crypto.randomUUID(),
					cardPk: item.cardPk,
					ordinal: item.ordinal,
					grade: 1 + (n % 4),
					servedAt: item.servedAt,
					deckId: 'live-soak'
				});
				note(r.status);
			}
			if (workerId === 0 && n % 20 === 0)
				note(
					(await postJson(url('main'), '/api/import', deck('live-soak', 500, n % 2 ? 20 : 21)))
						.status
				);
			if (n % 5 === 0) note((await http(url('main'), '/api/decks')).status);
		}
	};
	await Promise.all([0, 1, 2, 3].map(worker));
	await sampler;
	samples.push(memory());
	const valid = samples.filter((s) => Number.isFinite(s));
	console.log(
		`      ${stats.loops} loops, ${stats.ok} successful requests, memory samples (MiB): ${valid.map((s) => s.toFixed(0)).join(' ')}`
	);
	check(
		'the soak made requests without unexpected statuses',
		stats.ok > 0 && Object.keys(stats.odd).length === 0,
		JSON.stringify(stats.odd)
	);
	const warm = valid[Math.min(2, valid.length - 1)] ?? 0;
	const last = valid.at(-1) ?? 0;
	check(
		'memory stayed flat (within 25 percent plus 20 MiB of its level after warm-up)',
		valid.length >= 3 && last <= warm * 1.25 + 20,
		`${warm.toFixed(0)} to ${last.toFixed(0)} MiB`
	);
	const errors = remote(`docker logs ${id} 2>&1 | grep -c '"level":"error"'`).stdout.trim();
	check('no error lines in the server log', errors === '0', `${errors} lines`);
	check('still healthy after the soak', (await http(url('main'), '/healthz')).status === 200);
}

try {
	await main();
} catch (error) {
	console.error(`\nStopped: ${error instanceof Error ? error.message : error}`);
	failures++;
} finally {
	heading('Teardown');
	const removed = remote(teardownCommand(), { timeoutMs: 180_000 });
	check(
		'the test instance was taken down and its folder removed',
		removed.status === 0,
		removed.stderr.trim()
	);
	if (installedCandidate) remote(`docker rmi ${candidate}`);
	const volumes = remote(
		`docker volume ls --format '{{.Name}}' | grep '^${TEST_NAME}_' || true`
	).stdout.trim();
	check('no test volumes are left', volumes === '', volumes.replace(/\n/g, ', '));
	check('the test folder is gone', remote(`test ! -e ${TEST_DIR}`).status === 0);
	check(
		'the test containers are gone',
		remote(
			`docker ps -a --filter label=com.docker.compose.project=${TEST_NAME} -q`
		).stdout.trim() === ''
	);
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(
	`\n${passed} passed, ${failures} failed, ${skipped} skipped, in ${seconds} s. The API token used by the probe (${PROBE_TOKEN.slice(0, 11)}...) is a throwaway test value.`
);
if (skipped > 0) console.log('A skip is not a pass: see the SKIP lines above.');
console.log(failures === 0 ? 'No failed checks.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
