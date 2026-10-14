// Data integrity checks against the real production server: restarts, hard kills, and parallel writes.
//   node scripts/durability-check.ts        (run `npm run build` first)
// The study history is the valuable data, so these check that it survives, and that a killed import
// leaves either nothing or the whole deck, never half of one. Exits 1 on any failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { freePort, sleep } from './lib/net.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}

const dataDir = mkdtempSync(join(tmpdir(), 'tessera-durability-'));
let port = 0;
let base = '';
let child: ChildProcess | undefined;
let output: string[] = [];

async function start(): Promise<void> {
	port = await freePort();
	base = `http://127.0.0.1:${port}`;
	output = [];
	child = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			BODY_SIZE_LIMIT: '5M',
			LOG_LEVEL: 'info'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (d) => output.push(String(d)));
	child.stderr?.on('data', (d) => output.push(String(d)));
	for (let i = 0; i < 150; i++) {
		if (child.exitCode !== null)
			throw new Error(`server exited early: ${output.join('').slice(-400)}`);
		try {
			if ((await fetch(`${base}/healthz`)).ok) return;
		} catch {
			// not up yet
		}
		await sleep(200);
	}
	throw new Error('server did not start');
}

async function stop(signal: NodeJS.Signals): Promise<void> {
	const proc = child;
	if (!proc || proc.exitCode !== null) return;
	const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
	proc.kill(signal);
	await exited;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const api = async (path: string, init?: RequestInit) => {
	const response = await fetch(`${base}${path}`, init);
	// Response shapes are deliberately untyped here: this script probes the server from the outside.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { status: response.status, body: (await response.json().catch(() => undefined)) as any };
};
const post = (path: string, body: unknown) =>
	api(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

function bigDeck(id: string, count: number, suffix = '') {
	return {
		tessera: 1,
		deck: { id, title: id },
		cards: Array.from({ length: count }, (_, i) => ({
			id: `c-${i + 1}`,
			type: 'basic',
			front: `Question ${i + 1} ${'padding '.repeat(20)}`,
			back: `Answer ${i + 1}${suffix}`
		}))
	};
}

// Items left to study today. This is capped by the daily new-card limit, so it is not a card count.
const queueLeft = async (id: string): Promise<number | undefined> => {
	const { body } = await api('/api/decks');
	const found = (
		body.decks as { id: string; counts: { new: number; learning: number; review: number } }[]
	).find((deck) => deck.id === id);
	return found ? found.counts.new + found.counts.learning + found.counts.review : undefined;
};

// Reads the database file directly (read-only), so the check does not depend on the API under test.
function inspect<T>(work: (db: Database.Database) => T): T {
	const db = new Database(join(dataDir, 'tessera.db'), { readonly: true });
	try {
		return work(db);
	} finally {
		db.close();
	}
}

// Cards stored for a deck, or undefined when the deck does not exist.
const deckCount = (id: string): number | undefined =>
	inspect((db) => {
		const deck = db.prepare('select 1 from decks where id = ?').get(id);
		if (!deck) return undefined;
		return (
			db.prepare('select count(*) as n from cards where deck_id = ?').get(id) as { n: number }
		).n;
	});

// Every card has its review item rows, and SQLite itself finds no corruption or dangling references.
function structureProblems(): string[] {
	return inspect((db) => {
		const problems: string[] = [];
		const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
		if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
			problems.push(`integrity_check: ${JSON.stringify(integrity).slice(0, 120)}`);
		}
		const dangling = db.pragma('foreign_key_check') as unknown[];
		if (dangling.length > 0) problems.push(`${dangling.length} foreign key violations`);
		const orphans = (
			db
				.prepare(
					'select count(*) as n from cards c where not exists (select 1 from card_state s where s.card_pk = c.pk)'
				)
				.get() as { n: number }
		).n;
		if (orphans > 0) problems.push(`${orphans} cards without a review item`);
		return problems;
	});
}

try {
	// 1. A graceful restart keeps everything, including study progress.
	console.log('# Restart');
	await start();
	await post('/api/import', bigDeck('keep', 6));
	const reviewed: { cardPk: number; ordinal: number }[] = [];
	for (let i = 0; i < 3; i++) {
		const next = await api('/api/study/next?deckId=keep');
		const item = next.body.item;
		const result = await post('/api/study/review', {
			reviewId: `keep-review-${i}`,
			cardPk: item.cardPk,
			ordinal: item.ordinal,
			grade: 4,
			servedAt: item.servedAt,
			deckId: 'keep'
		});
		check(`review ${i + 1} saved`, result.status === 200, `status ${result.status}`);
		reviewed.push({ cardPk: item.cardPk, ordinal: item.ordinal });
	}
	const beforeRestart = await api('/api/decks');
	await stop('SIGTERM');
	if (process.platform === 'win32') {
		// Windows has no SIGTERM: kill() ends the process at once, so no shutdown code runs. The graceful
		// path is checked on Linux, by the container job in CI ("Shuts down gracefully on SIGTERM").
		console.log('SKIP  graceful SIGTERM exit code (Windows cannot deliver SIGTERM)');
	} else {
		check(
			'SIGTERM shuts down cleanly with exit code 0',
			child?.exitCode === 0,
			`code ${child?.exitCode}`
		);
	}
	await start();
	const afterRestart = await api('/api/decks');
	check(
		'decks and counts are identical after a restart',
		JSON.stringify(afterRestart.body.decks) === JSON.stringify(beforeRestart.body.decks)
	);
	const replay = await post('/api/study/review', {
		reviewId: 'keep-review-0',
		cardPk: reviewed[0]!.cardPk,
		ordinal: reviewed[0]!.ordinal,
		grade: 4,
		servedAt: new Date().toISOString(),
		deckId: 'keep'
	});
	check(
		'a review id from before the restart is still remembered (replayed)',
		replay.body?.result?.replayed === true,
		JSON.stringify(replay.body).slice(0, 120)
	);

	// 2. A grade the server acknowledged survives a hard kill.
	console.log('\n# Hard kill after a saved grade');
	const next = await api('/api/study/next?deckId=keep');
	const item = next.body.item;
	const saved = await post('/api/study/review', {
		reviewId: 'killed-after-ack',
		cardPk: item.cardPk,
		ordinal: item.ordinal,
		grade: 4,
		servedAt: item.servedAt,
		deckId: 'keep'
	});
	check('the grade was acknowledged', saved.status === 200);
	await stop('SIGKILL');
	await start();
	const replayAfterKill = await post('/api/study/review', {
		reviewId: 'killed-after-ack',
		cardPk: item.cardPk,
		ordinal: item.ordinal,
		grade: 4,
		servedAt: new Date().toISOString(),
		deckId: 'keep'
	});
	check(
		'the acknowledged grade is still there after SIGKILL',
		replayAfterKill.body?.result?.replayed === true
	);

	// 3. A hard kill in the middle of a big import leaves nothing, or the whole deck.
	console.log('\n# Hard kill during a 5,000 card import');
	const outcomes: string[] = [];
	for (const [round, delay] of [40, 120, 250, 400, 600, 800, 950, 1100, 1300, 1600].entries()) {
		const id = `big-${round}`;
		const pending = fetch(`${base}/api/import`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify(bigDeck(id, 5000))
		}).then(
			(r) => r.status,
			() => 'connection lost'
		);
		await sleep(delay);
		await stop('SIGKILL');
		const outcome = await pending;
		await start();
		const count = await deckCount(id);
		check(
			`kill after ${delay} ms (import ${outcome}): the deck is absent or complete`,
			count === undefined || count === 5000,
			`found ${count} items`
		);
		const health = await api('/healthz');
		check(
			`kill after ${delay} ms: the database reopens and serves requests`,
			health.status === 200
		);
		// Whatever happened, the earlier study history must be untouched.
		check(
			`kill after ${delay} ms: earlier decks are untouched`,
			(await queueLeft('keep')) === 2 && deckCount('keep') === 6
		);
		const problems = structureProblems();
		check(
			`kill after ${delay} ms: SQLite integrity and foreign key checks pass`,
			problems.length === 0,
			problems.join('; ')
		);
		// Remember which outcome happened, to report that both branches were seen or not.
		outcomes.push(count === undefined ? 'rolled back' : 'committed');
	}
	console.log(`INFO  outcomes by kill time: ${outcomes.join(', ')}`);

	// 4. Parallel writes.
	console.log('\n# Parallel writes');
	const same = await Promise.all(
		Array.from({ length: 10 }, () => post('/api/import', bigDeck('parallel', 300)))
	);
	check(
		'10 simultaneous imports of one deck all succeed',
		same.every((r) => r.status === 200),
		same.map((r) => r.status).join(',')
	);
	check(
		'and leave exactly one copy of each card',
		(await deckCount('parallel')) === 300,
		`found ${await deckCount('parallel')}`
	);

	const edits = await Promise.all(
		Array.from({ length: 10 }, (_, i) =>
			post('/api/import', bigDeck('parallel', 300, ` edit-${i}`))
		)
	);
	check(
		'10 simultaneous different edits all succeed',
		edits.every((r) => r.status === 200),
		edits.map((r) => r.status).join(',')
	);
	check('and still leave exactly 300 cards', (await deckCount('parallel')) === 300);

	await post('/api/import', bigDeck('race', 3));
	const raceItem = (await api('/api/study/next?deckId=race')).body.item;
	const race = await Promise.all(
		Array.from({ length: 8 }, (_, i) =>
			post('/api/study/review', {
				reviewId: `race-review-${i}`,
				cardPk: raceItem.cardPk,
				ordinal: raceItem.ordinal,
				grade: 3,
				servedAt: raceItem.servedAt,
				deckId: 'race'
			})
		)
	);
	const ok = race.filter((r) => r.status === 200).length;
	const stale = race.filter((r) => r.status === 409).length;
	check(
		'8 different grades for one card at once: exactly one wins, the rest are stale',
		ok === 1 && stale === 7,
		`${ok} saved, ${stale} stale, others: ${race.map((r) => r.status).join(',')}`
	);

	const sameId = await Promise.all(
		Array.from({ length: 8 }, () => {
			const next = raceItem;
			return post('/api/study/review', {
				reviewId: 'one-id-eight-times',
				cardPk: next.cardPk,
				ordinal: next.ordinal,
				grade: 3,
				servedAt: new Date().toISOString(),
				deckId: 'race'
			});
		})
	);
	check(
		'one review id sent 8 times at once never errors',
		sameId.every((r) => r.status === 200 || r.status === 409),
		sameId.map((r) => r.status).join(',')
	);

	check(
		'no unhandled errors were logged during all of this',
		!output.join('').includes('"level":"error"'),
		output
			.join('')
			.split('\n')
			.find((l) => l.includes('"level":"error"'))
			?.slice(0, 200) ?? ''
	);
} catch (error) {
	console.error('\nCheck aborted:', error instanceof Error ? error.message : error);
	failures++;
} finally {
	await stop('SIGKILL').catch(() => undefined);
	await sleep(300);
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures === 0 ? '\nNo failed checks.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
