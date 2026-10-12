// Runs the procedures and failures described in docs/operations.md against the real production server
// and checks the page tells the truth: the backup command is extracted from the page and run as written,
// a restore works, every error message in the troubleshooting table is what the app prints, damaged
// files are never modified, and two copies on one data folder keep working.
//   node scripts/ops-check.ts        (run `npm run build` first)
// Exits 1 on any failed check.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
	writeFileSync
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = mkdtempSync(join(tmpdir(), 'tessera-ops-'));
const launched: ChildProcess[] = [];
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

interface Running {
	proc: ChildProcess;
	url: string;
	output: () => string;
	exitCode: () => number | null;
}

function launch(
	dataDir: string,
	extraEnv: Record<string, string> = {},
	port?: number
): Promise<Running> {
	return (async () => {
		const p = port ?? (await freePort());
		const proc = spawn(process.execPath, ['build/index.js'], {
			env: {
				...process.env,
				NODE_ENV: 'production',
				HOST: '127.0.0.1',
				PORT: String(p),
				DATA_DIR: dataDir,
				BODY_SIZE_LIMIT: '5M',
				LOG_LEVEL: 'info',
				...extraEnv
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const chunks: string[] = [];
		proc.stdout?.on('data', (d) => chunks.push(String(d)));
		proc.stderr?.on('data', (d) => chunks.push(String(d)));
		let code: number | null = null;
		proc.on('exit', (c) => (code = c));
		launched.push(proc);
		return {
			proc,
			url: `http://127.0.0.1:${p}`,
			output: () => chunks.join(''),
			exitCode: () => code
		};
	})();
}

async function waitHealthy(server: Running): Promise<boolean> {
	for (let i = 0; i < 150 && server.exitCode() === null; i++) {
		try {
			const r = await fetch(`${server.url}/healthz`, { signal: AbortSignal.timeout(1000) });
			if (r.status === 200) return true;
		} catch {
			// not up yet
		}
		await sleep(100);
	}
	return false;
}

async function startHealthy(dataDir: string): Promise<Running> {
	const server = await launch(dataDir);
	if (!(await waitHealthy(server)))
		throw new Error(`server did not start: ${server.output().slice(-300)}`);
	return server;
}

const stop = async (server: Running) => {
	server.proc.kill();
	await sleep(400);
};

// Starts a server that is expected to refuse to run. Returns its exit code and everything it printed.
async function expectRefusal(dataDir: string, env: Record<string, string> = {}, port?: number) {
	const server = await launch(dataDir, env, port);
	for (let i = 0; i < 80 && server.exitCode() === null; i++) await sleep(100);
	const code = server.exitCode();
	if (code === null) await stop(server);
	return { code, text: server.output() };
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const call = async (server: Running, path: string, body?: unknown) => {
	const response = await fetch(server.url + path, {
		...(body === undefined
			? {}
			: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(20_000)
	});
	// Response shapes are deliberately untyped: this script probes the server from the outside.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { status: response.status, body: (await response.json().catch(() => undefined)) as any };
};

const deckOf = (id: string, count: number) => ({
	tessera: 1,
	deck: { id, title: id },
	cards: Array.from({ length: count }, (_, i) => ({
		id: `c-${i + 1}`,
		type: 'basic',
		front: `Question ${i + 1}`,
		back: `Answer ${i + 1}`
	}))
});

async function grade(server: Running, deckId: string, reviewId: string, rating = 4) {
	const next = await call(server, `/api/study/next?deckId=${deckId}`);
	if (next.body.done) return undefined;
	const item = next.body.item;
	const result = await call(server, '/api/study/review', {
		reviewId,
		cardPk: item.cardPk,
		ordinal: item.ordinal,
		grade: rating,
		servedAt: item.servedAt,
		deckId
	});
	return { status: result.status, cardPk: item.cardPk, ordinal: item.ordinal };
}

function counts(file: string) {
	const db = new Database(file, { readonly: true });
	try {
		return {
			integrity: db.pragma('integrity_check', { simple: true }) as string,
			cards: (db.prepare('select count(*) as n from cards').get() as { n: number }).n,
			reviews: (db.prepare('select count(*) as n from review_log').get() as { n: number }).n
		};
	} finally {
		db.close();
	}
}

try {
	// ---- The backup command, taken from the documentation page
	console.log('# Backup and restore, as documented');
	const doc = readFileSync('docs/operations.md', 'utf8');
	const block = /<!-- backup-command -->\s*```bash\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';
	const payload = /node -e "([\s\S]*?)" \/data\/tessera\.db/.exec(block)?.[1];
	check(
		'the backup command was found in docs/operations.md',
		Boolean(payload) && block.includes('docker compose exec tessera node -e')
	);
	if (!payload) throw new Error('cannot continue without the documented backup command');

	const live = join(base, 'live');
	let server = await startHealthy(live);
	await call(server, '/api/import', deckOf('ops', 400));
	const reviewIds: string[] = [];
	for (let i = 0; i < 6; i++) {
		const id = `ops-review-${i}`;
		const r = await grade(server, 'ops', id);
		if (r?.status === 200) reviewIds.push(id);
	}
	check(
		'six grades were saved before the backup',
		reviewIds.length === 6,
		String(reviewIds.length)
	);

	// Writes continue while the backup runs.
	let running = true;
	let during = 0;
	const failuresDuring: number[] = [];
	const writer = (async () => {
		let n = 0;
		while (running) {
			const r = await grade(
				server,
				'ops',
				`ops-load-${n++}-${Math.random().toString(36).slice(2, 8)}`,
				3
			);
			if (!r) break;
			if (r.status === 200) during++;
			else failuresDuring.push(r.status);
		}
	})();
	await sleep(150);
	// Where the guide puts it: inside the data folder's backups folder, which a fresh install must already have
	// (it once did not, and the documented command failed on first use).
	check(
		'the backups folder exists on a fresh install, before any upgrade backup',
		existsSync(join(live, 'backups'))
	);
	const backupFile = join(live, 'backups', 'manual-backup.db');
	const started = performance.now();
	const run = spawnSync(process.execPath, ['-e', payload, join(live, 'tessera.db'), backupFile], {
		encoding: 'utf8'
	});
	const took = Math.round(performance.now() - started);
	await sleep(100);
	running = false;
	await writer;
	check(
		'the documented backup command succeeds while the server is running',
		run.status === 0,
		run.stderr.slice(0, 200)
	);
	check('and finishes quickly', took < 5000, `${took} ms`);
	check(
		'and does not disturb the writes happening at the same time',
		failuresDuring.length === 0,
		`${during} ok, failures ${failuresDuring.join(',')}`
	);
	const backed = counts(backupFile);
	check('the backup passes SQLite integrity_check', backed.integrity === 'ok', backed.integrity);
	check(
		'the backup holds all cards and the earlier reviews',
		backed.cards === 400 && backed.reviews >= 6,
		JSON.stringify(backed)
	);
	const second = spawnSync(
		process.execPath,
		['-e', payload, join(live, 'tessera.db'), backupFile],
		{ encoding: 'utf8' }
	);
	check('running it twice to one file is refused rather than overwriting', second.status !== 0);

	// A plain file copy of a running server is not a backup.
	const small = join(base, 'small');
	const smallServer = await startHealthy(small);
	await call(smallServer, '/api/import', deckOf('tiny', 30));
	const rawCopy = join(base, 'raw-copy.db');
	copyFileSync(join(small, 'tessera.db'), rawCopy);
	let rawCards = 0;
	try {
		rawCards = counts(rawCopy).cards;
	} catch {
		// "no such table": the schema itself is still in the write-ahead log, so the copy is empty.
	}
	check(
		'copying tessera.db alone from a running server loses recent data (so the page warns against it)',
		rawCards < 30,
		`copy has ${rawCards} of 30 cards`
	);
	await stop(smallServer);

	await stop(server);
	const restored = join(base, 'restored');
	mkdirSync(restored, { recursive: true });
	copyFileSync(backupFile, join(restored, 'tessera.db'));
	server = await startHealthy(restored);
	const decks = await call(server, '/api/decks');
	check(
		'a server started on the restored backup is healthy and lists the deck',
		decks.status === 200 && decks.body.decks.some((d: { id: string }) => d.id === 'ops')
	);
	const replay = await call(server, '/api/study/review', {
		reviewId: reviewIds[0],
		cardPk: 1,
		ordinal: 0,
		grade: 3,
		servedAt: new Date().toISOString(),
		deckId: 'ops'
	});
	check(
		'review ids from before the backup are still remembered after the restore',
		replay.body?.result?.replayed === true,
		JSON.stringify(replay.body).slice(0, 120)
	);
	await stop(server);

	// ---- The troubleshooting table
	console.log('\n# Error messages in the troubleshooting table');
	const fresh = (name: string) => join(base, name);
	const cases: [string, Record<string, string>, RegExp][] = [
		['PORT out of range', { PORT: '99999' }, /Invalid configuration:[\s\S]*PORT/],
		[
			'TZ not a time zone',
			{ TZ: 'Mars/Olympus' },
			/Invalid configuration:[\s\S]*TZ: is not a valid IANA time zone/
		],
		['LOG_LEVEL unknown', { LOG_LEVEL: 'loud' }, /Invalid configuration:[\s\S]*LOG_LEVEL/],
		[
			'API token too short',
			{ TESSERA_API_TOKEN: 'short' },
			/Invalid configuration:[\s\S]*TESSERA_API_TOKEN: must be at least 24 characters/
		]
	];
	for (const [label, env, pattern] of cases) {
		const { code, text } = await expectRefusal(fresh(`cfg-${label.replace(/\W+/g, '')}`), env);
		check(
			`${label}: refuses to start and names the setting`,
			code === 1 && pattern.test(text),
			`exit ${code}`
		);
	}

	const blocker = fresh('a-file');
	writeFileSync(blocker, 'x');
	const unwritable = await expectRefusal(join(blocker, 'sub'));
	check(
		'an unusable data folder: refuses and says how to fix it',
		unwritable.code === 1 && /Cannot write to the data directory/.test(unwritable.text),
		`exit ${unwritable.code}`
	);

	const garbage = fresh('damaged');
	mkdirSync(garbage, { recursive: true });
	writeFileSync(join(garbage, 'tessera.db'), Buffer.from('this is not a database '.repeat(500)));
	const garbageBefore = sha(join(garbage, 'tessera.db'));
	const damaged = await expectRefusal(garbage);
	check(
		'a damaged file: refuses to start with the "damaged or is not a Tessera database" message',
		damaged.code === 1 &&
			/damaged or is not a Tessera database/.test(damaged.text) &&
			/Restore the most recent backup/.test(damaged.text),
		damaged.text.slice(-200)
	);
	check(
		'a damaged file is left byte for byte unchanged',
		sha(join(garbage, 'tessera.db')) === garbageBefore
	);

	const cut = fresh('truncated');
	mkdirSync(cut, { recursive: true });
	copyFileSync(backupFile, join(cut, 'tessera.db'));
	truncateSync(join(cut, 'tessera.db'), Math.floor(statSync(backupFile).size / 2));
	const cutBefore = sha(join(cut, 'tessera.db'));
	const truncated = await expectRefusal(cut);
	check(
		'a database cut in half: refuses to start, does not run on partial data',
		truncated.code === 1 && /damaged or is not a Tessera database/.test(truncated.text),
		`exit ${truncated.code}`
	);
	check('and is left unchanged', sha(join(cut, 'tessera.db')) === cutBefore);

	const newer = fresh('newer');
	mkdirSync(newer, { recursive: true });
	copyFileSync(backupFile, join(newer, 'tessera.db'));
	const edit = new Database(join(newer, 'tessera.db'));
	// A database that a real server wrote is already in WAL mode. Opening a file in any other mode
	// switches it, which edits one header byte and would hide what this check is for.
	edit.pragma('journal_mode = WAL');
	edit
		.prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
		.run('from-the-future', Date.now() + 10 * 365 * 86_400_000);
	edit.close();
	const newerBefore = sha(join(newer, 'tessera.db'));
	const tooNew = await expectRefusal(newer);
	check(
		'a database from a newer version: an older version refuses to start with the rollback message',
		tooNew.code === 1 &&
			/written by a newer version of Tessera/.test(tooNew.text) &&
			/backups/.test(tooNew.text),
		`exit ${tooNew.code}`
	);
	check(
		'and leaves it unchanged, so no data is lost by trying',
		sha(join(newer, 'tessera.db')) === newerBefore
	);

	const squatter = createServer();
	const busyPort = await freePort();
	await new Promise<void>((r) => squatter.listen(busyPort, '127.0.0.1', () => r()));
	const busy = await expectRefusal(fresh('busy'), {}, busyPort);
	squatter.close();
	check(
		'a port already in use: exits with EADDRINUSE',
		busy.code === 1 && /EADDRINUSE/.test(busy.text),
		`exit ${busy.code}`
	);

	// ---- Two copies on one data folder (an upgrade where the old container is still up)
	console.log('\n# Two copies on one data folder');
	const shared = fresh('shared');
	const a = await startHealthy(shared);
	const b = await startHealthy(shared);
	const results = await Promise.all(
		Array.from({ length: 60 }, (_, i) =>
			call(i % 2 ? a : b, '/api/import', deckOf(`shared-${i % 5}`, 200))
		)
	);
	const failed = results.filter((r) => r.status !== 200);
	check(
		'60 concurrent imports through both copies all succeed (writes wait their turn)',
		failed.length === 0,
		`${failed.length} failed: ${[...new Set(failed.map((r) => r.status))].join(',')}`
	);
	const merged = counts(join(shared, 'tessera.db'));
	check(
		'and the shared database stays intact',
		merged.integrity === 'ok' && merged.cards === 1000,
		JSON.stringify(merged)
	);
	const logs = a.output() + b.output();
	check(
		'and neither copy logged an error',
		!logs.includes('"level":"error"'),
		logs
			.split('\n')
			.find((l) => l.includes('"level":"error"'))
			?.slice(0, 160) ?? ''
	);
	await stop(a);
	await stop(b);
} catch (error) {
	console.error('\nCheck aborted:', error instanceof Error ? error.message : error);
	failures++;
} finally {
	// Whatever happened, no server may keep the temporary folder open.
	for (const proc of launched) proc.kill();
	await sleep(600);
	rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures === 0 ? '\nNo failed checks.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
