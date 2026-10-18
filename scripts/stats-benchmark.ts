// Times the Statistics queries over a long history: 100,000 review records (about eight months of 400 reviews a day)
// on a real server (ADR-017).
//   node scripts/stats-benchmark.ts
// Starts build/index.js on a free port with a temp data folder, imports two decks, puts them in a folder, writes the
// review records straight into the database file, then times GET /api/stats for every deck, one deck, and one folder,
// and the folder panel. Exits 1 if the page's main request is slower than the 1 second budget. Run `npm run build`
// first. It writes to the database file directly, so it only works on a server it starts itself.
import Database from 'better-sqlite3';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from './lib/net.ts';

const BUDGET_MS = 1000;
const REVIEWS = 100_000;
const CARDS_PER_DECK = 1500;
const DAY_MS = 86_400_000;

async function waitForHealth(base: string, child: ChildProcess) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
		try {
			if ((await fetch(`${base}/healthz`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error('server did not become healthy within 30s');
}

function deckOf(id: string) {
	const cards = Array.from({ length: CARDS_PER_DECK }, (_, i) => ({
		id: `${id}-${i + 1}`,
		type: 'basic',
		front: `Question ${i + 1} of ${id}`,
		back: `Answer ${i + 1}`,
		tags: ['bench', `group-${i % 25}`]
	}));
	return { tessera: 1, deck: { id, title: `Benchmark ${id}` }, cards };
}

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'tessera-statsbench-'));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['build/index.js'], {
	env: {
		...process.env,
		NODE_ENV: 'production',
		PORT: String(port),
		HOST: '127.0.0.1',
		DATA_DIR: dataDir,
		BODY_SIZE_LIMIT: '5M',
		LOG_LEVEL: 'warn'
	},
	stdio: ['ignore', 'ignore', 'inherit']
});

let exitCode = 0;

try {
	await waitForHealth(base, child);
	const json = { 'content-type': 'application/json' };
	for (const id of ['stats-a', 'stats-b']) {
		const response = await fetch(`${base}/api/import`, {
			method: 'POST',
			headers: json,
			body: JSON.stringify(deckOf(id))
		});
		if (!response.ok) throw new Error(`import failed: ${response.status}`);
	}
	const made = await fetch(`${base}/api/folders`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify({ name: 'Benchmark folder' })
	});
	const folderId = ((await made.json()) as { folder: { id: number } }).folder.id;
	await fetch(`${base}/api/folder-assignments`, {
		method: 'PUT',
		headers: json,
		body: JSON.stringify({ deckIds: ['stats-a'], folderId })
	});

	// Write the history straight into the database file. The server keeps running; SQLite waits for the write lock.
	const db = new Database(join(dataDir, 'tessera.db'));
	db.pragma('busy_timeout = 10000');
	const items = db
		.prepare('select card_pk as cardPk, ordinal from card_state order by card_pk, ordinal')
		.all() as { cardPk: number; ordinal: number }[];
	const now = Date.now();
	let seed = 12345;
	const random = () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
	const insert = db.prepare(
		`insert into review_log (id, card_pk, ordinal, mode, grade, pre_due, pre_stability, pre_difficulty, pre_elapsed_days,
			pre_scheduled_days, pre_learning_steps, pre_reps, pre_lapses, pre_phase, pre_last_review, result, scheduled_days,
			duration_ms, typed_answer, reviewed_at) values (?, ?, ?, ?, ?, ?, 5, 5, 3, 3, 0, 4, 0, ?, null, null, null, ?, null, ?)`
	);
	const writeHistory = db.transaction(() => {
		for (let i = 0; i < REVIEWS; i++) {
			const item = items[Math.floor(random() * items.length)]!;
			const reviewedAt = new Date(now - random() * 240 * DAY_MS).toISOString();
			insert.run(
				`bench-${i}`,
				item.cardPk,
				item.ordinal,
				random() < 0.9 ? 'review' : 'cram',
				random() < 0.15 ? 1 : 3,
				reviewedAt,
				random() < 0.75 ? 2 : 1,
				4000 + Math.floor(random() * 8000),
				reviewedAt
			);
		}
		// Schedule most items: a spread of due dates over the next 60 days, some overdue.
		const update = db.prepare(
			'update card_state set phase = 2, due = ?, reps = 5, stability = 8, difficulty = 5, last_review = ? where card_pk = ? and ordinal = ?'
		);
		for (const item of items) {
			if (random() < 0.8) {
				const due = now + (random() * 70 - 5) * DAY_MS;
				update.run(
					new Date(due).toISOString(),
					new Date(due - 8 * DAY_MS).toISOString(),
					item.cardPk,
					item.ordinal
				);
			}
		}
	});
	writeHistory();
	const count = (db.prepare('select count(*) as n from review_log').get() as { n: number }).n;
	console.log(
		`History: ${count.toLocaleString()} review records over ${items.length.toLocaleString()} items\n`
	);

	const rows: { label: string; median: number; p95: number; bytes: number }[] = [];
	async function measure(label: string, path: string, runs = 20) {
		const times: number[] = [];
		let bytes = 0;
		for (let i = 0; i < runs; i++) {
			const start = performance.now();
			const response = await fetch(`${base}${path}`);
			const text = await response.text();
			times.push(performance.now() - start);
			bytes = text.length;
			if (!response.ok) throw new Error(`${path} answered ${response.status}`);
		}
		rows.push({ label, median: percentile(times, 50), p95: percentile(times, 95), bytes });
		return percentile(times, 50);
	}

	const main = await measure('GET /api/stats (every deck)', '/api/stats');
	await measure('GET /api/stats?deckId= (one deck)', '/api/stats?deckId=stats-b');
	await measure('GET /api/stats?folderId= (one folder)', `/api/stats?folderId=${folderId}`);
	await measure('GET /api/folders/:id/stats (folder panel)', `/api/folders/${folderId}/stats`);
	await measure('GET /api/decks (home screen)', '/api/decks');
	await measure('GET /api/practice/pool', '/api/practice/pool?deckId=stats-a');

	const width = Math.max(...rows.map((row) => row.label.length));
	for (const row of rows) {
		console.log(
			`${row.label.padEnd(width)}  median ${row.median.toFixed(1).padStart(7)} ms   95th ${row.p95.toFixed(1).padStart(7)} ms   ${(row.bytes / 1024).toFixed(1).padStart(6)} KB`
		);
	}

	// What SQLite does with the main review queries, so a scan on the review log is easy to spot.
	console.log('\nQuery plans (a SCAN of review_log would be a problem):');
	const plans: [string, string][] = [
		[
			'reviews since a time, one mode',
			`select count(*) from review_log r join cards c on c.pk = r.card_pk join decks d on d.id = c.deck_id where d.archived = 0 and r.mode = 'review' and r.reviewed_at >= '2026-01-01'`
		],
		[
			'review points for the heatmap',
			`select r.reviewed_at, r.grade, r.duration_ms from review_log r join cards c on c.pk = r.card_pk join decks d on d.id = c.deck_id where d.archived = 0 and r.mode = 'review' and r.reviewed_at >= '2026-01-01' order by r.reviewed_at`
		],
		[
			'forecast: when items fall due',
			`select s.due, s.phase from card_state s join cards c on c.pk = s.card_pk join decks d on d.id = c.deck_id where d.archived = 0 and c.archived = 0 and c.suspended = 0 and s.archived = 0 and s.phase in (1, 2, 3) and s.due <= '2027-01-01'`
		]
	];
	for (const [label, sql] of plans) {
		const plan = db.prepare(`explain query plan ${sql}`).all() as { detail: string }[];
		console.log(`- ${label}`);
		for (const step of plan) console.log(`    ${step.detail}`);
	}
	db.close();

	const within = main <= BUDGET_MS;
	console.log(
		`\n${within ? 'PASS' : 'FAIL'}  the Statistics request takes ${main.toFixed(0)} ms (median), budget ${BUDGET_MS} ms`
	);
	if (!within) exitCode = 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	exitCode = 1;
} finally {
	const exited = new Promise((resolve) => child.once('exit', resolve));
	child.kill();
	await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
	try {
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
	} catch {
		console.warn(`Could not remove ${dataDir}; delete it by hand.`);
	}
}
process.exit(exitCode);
