// Times the import and study paths with a full 5,000-card deck (the import limit) against a real server.
//   node scripts/benchmark.ts          starts build/index.js on a free port with a temp data dir
//   node scripts/benchmark.ts --base http://host:3000
// Exits 1 if importing 5,000 cards takes longer than the 10 second budget. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMPORT_BUDGET_MS = 10_000;
const CARDS = 5000;

const args = process.argv.slice(2);
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;

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

async function waitForHealth(base: string, child: ChildProcess | undefined) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child && child.exitCode !== null)
			throw new Error(`server exited with code ${child.exitCode}`);
		try {
			if ((await fetch(`${base}/healthz`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error('server did not become healthy within 30s');
}

// A realistic mix: mostly basic cards with code and a table, some cloze with two blanks, some typed.
function buildDeck(changedBackSuffix = '') {
	const cards = Array.from({ length: CARDS }, (_, i) => {
		const n = i + 1;
		const kind = i % 10 < 6 ? 'basic' : i % 10 < 9 ? 'cloze' : 'typed';
		const id = `bench-${n}`;
		const body = `Topic ${n} explains how the protocol picks a path, why the metric matters, and what to check first when it misbehaves.`;
		if (kind === 'basic') {
			const changed = changedBackSuffix && i % 10 === 0;
			return {
				id,
				type: 'basic',
				front: `What does item ${n} do?\n\n\`\`\`text\nrouter ospf ${n}\n network 10.${n % 255}.0.0 0.0.255.255 area 0\n\`\`\``,
				back: `${body}\n\n| Field | Value |\n|---|---|\n| cost | ${n} |\n| area | 0 |${changed ? changedBackSuffix : ''}`,
				tags: ['bench', `group-${n % 25}`]
			};
		}
		if (kind === 'cloze') {
			return {
				id,
				type: 'cloze',
				text: `Item ${n} uses {{c1::cost ${n}}} on the {{c2::area ${n % 5}}} interface. ${body}`,
				tags: ['bench']
			};
		}
		return { id, type: 'typed', front: `Command for item ${n}?`, answer: `show ip route ${n}` };
	});
	return { tessera: 1, deck: { id: 'bench', title: 'Benchmark deck' }, cards };
}

async function timed<T>(
	label: string,
	work: () => Promise<T>
): Promise<{ label: string; ms: number; value: T }> {
	const start = performance.now();
	const value = await work();
	return { label, ms: performance.now() - start, value };
}

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

let child: ChildProcess | undefined;
let dataDir: string | undefined;
let base: string;

if (baseArg) {
	base = baseArg;
} else {
	const port = await freePort();
	dataDir = mkdtempSync(join(tmpdir(), 'tessera-bench-'));
	base = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, ['build/index.js'], {
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
}

const rows: { label: string; ms: number }[] = [];
let exitCode = 0;

try {
	await waitForHealth(base, child);

	const post = async (path: string, body: string) => {
		const response = await fetch(`${base}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		});
		if (!response.ok)
			throw new Error(`${path} failed: HTTP ${response.status} ${await response.text()}`);
		return (await response.json()) as Record<string, unknown>;
	};

	const original = JSON.stringify(buildDeck());
	const edited = JSON.stringify(buildDeck('\n\nEdited.'));
	console.log(`Deck: ${CARDS} cards, ${(original.length / 1024 / 1024).toFixed(2)} MB of JSON\n`);

	rows.push(
		await timed('Preview (dry run), new deck', () => post('/api/import?dry_run=true', original))
	);
	const firstImport = await timed('Import, new deck', () => post('/api/import', original));
	rows.push(firstImport);
	rows.push(await timed('Re-import, unchanged', () => post('/api/import', original)));
	rows.push(await timed('Re-import, 10% of cards edited', () => post('/api/import', edited)));

	const decks = [];
	for (let i = 0; i < 30; i++)
		decks.push((await timed('decks', () => fetch(`${base}/api/decks`).then((r) => r.text()))).ms);
	rows.push({ label: 'GET /api/decks (median of 30)', ms: percentile(decks, 50) });

	const next = [];
	for (let i = 0; i < 50; i++)
		next.push(
			(
				await timed('next', () =>
					fetch(`${base}/api/study/next?deckId=bench`).then((r) => r.text())
				)
			).ms
		);
	rows.push({ label: 'GET /api/study/next (median of 50)', ms: percentile(next, 50) });
	rows.push({ label: 'GET /api/study/next (95th percentile)', ms: percentile(next, 95) });

	const reviews = [];
	for (let i = 0; i < 50; i++) {
		const response = await fetch(`${base}/api/study/next?deckId=bench`);
		const body = (await response.json()) as {
			done: boolean;
			item?: { cardPk: number; ordinal: number; servedAt: string };
		};
		if (body.done || !body.item) break;
		const { cardPk, ordinal, servedAt } = body.item;
		const request = JSON.stringify({
			reviewId: crypto.randomUUID(),
			cardPk,
			ordinal,
			grade: 3,
			servedAt,
			deckId: 'bench'
		});
		reviews.push((await timed('review', () => post('/api/study/review', request))).ms);
	}
	rows.push({
		label: `POST /api/study/review (median of ${reviews.length})`,
		ms: percentile(reviews, 50)
	});
	rows.push({ label: 'POST /api/study/review (95th percentile)', ms: percentile(reviews, 95) });

	const width = Math.max(...rows.map((r) => r.label.length));
	for (const row of rows)
		console.log(`${row.label.padEnd(width)}  ${row.ms.toFixed(1).padStart(9)} ms`);

	const slowest = Math.max(firstImport.ms, ...rows.slice(0, 4).map((r) => r.ms));
	const within = slowest <= IMPORT_BUDGET_MS;
	console.log(
		`\n${within ? 'PASS' : 'FAIL'}  slowest import path ${(slowest / 1000).toFixed(2)} s, budget ${IMPORT_BUDGET_MS / 1000} s`
	);
	if (!within) exitCode = 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	exitCode = 1;
} finally {
	child?.kill();
	if (dataDir) {
		await new Promise((r) => setTimeout(r, 300));
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}
process.exit(exitCode);
