// Smoke test against a real running Tessera server.
//   node scripts/smoke.ts                         starts build/index.js on a free port with a temp data dir
//   node scripts/smoke.ts --base http://host:3000  tests an already running server (CI uses this against the Docker image)
// Exits 1 if any check fails. Run `npm run build` first when it starts the server itself.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from './lib/net.ts';

const args = process.argv.slice(2);
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}

// Reads a value from parsed JSON without trusting its shape.
function dig(value: unknown, ...path: (string | number)[]): unknown {
	let current = value;
	for (const key of path) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

async function waitForHealth(base: string, child: ChildProcess | undefined, seconds = 30) {
	const deadline = Date.now() + seconds * 1000;
	while (Date.now() < deadline) {
		if (child && child.exitCode !== null) {
			throw new Error(`server exited early with code ${child.exitCode}`);
		}
		try {
			if ((await fetch(`${base}/healthz`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`server did not become healthy within ${seconds}s`);
}

let child: ChildProcess | undefined;
let dataDir: string | undefined;
let base: string;
const output: string[] = [];

if (baseArg) {
	base = baseArg;
} else {
	const port = await freePort();
	dataDir = mkdtempSync(join(tmpdir(), 'tessera-smoke-'));
	base = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			BODY_SIZE_LIMIT: '5M'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (d) => output.push(String(d)));
	child.stderr?.on('data', (d) => output.push(String(d)));
}

const deck = readFileSync('tests/fixtures/decks/valid/ccna-ospf.json', 'utf8');
const json = { 'content-type': 'application/json' };

try {
	await waitForHealth(base, child);

	const health = await fetch(`${base}/healthz`);
	const healthBody: unknown = await health.json();
	check(
		'GET /healthz is ok',
		health.status === 200 && dig(healthBody, 'ok') === true && dig(healthBody, 'dbOk') === true
	);

	const schema = await fetch(`${base}/api/schema`);
	const schemaBody: unknown = await schema.json();
	check(
		'GET /api/schema serves the JSON Schema',
		schema.status === 200 &&
			String(dig(schemaBody, '$schema')).includes('2020-12') &&
			(schema.headers.get('content-type') ?? '').includes('schema+json')
	);

	const home = await fetch(`${base}/`);
	const csp = home.headers.get('content-security-policy') ?? '';
	check(
		'GET / returns the app shell',
		home.status === 200 && (await home.text()).includes('<html')
	);
	check('GET / sets a Content-Security-Policy', csp.includes("default-src 'self'"), csp);
	check(
		'script-src is locked down (self plus a nonce or hash, no unsafe-inline or eval)',
		/script-src 'self'/.test(csp) &&
			/(nonce-|sha256-)/.test(csp) &&
			!/script-src[^;]*unsafe-(inline|eval)/.test(csp),
		csp
	);
	check(
		"frame-ancestors is 'none' and object-src is 'none'",
		csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'")
	);
	check(
		'security headers are set',
		home.headers.get('x-content-type-options') === 'nosniff' &&
			home.headers.get('referrer-policy') === 'no-referrer'
	);
	check('every response carries a request id', Boolean(home.headers.get('x-request-id')));
	check('no CORS headers are ever sent', !home.headers.has('access-control-allow-origin'));

	const preflight = await fetch(`${base}/api/import`, {
		method: 'OPTIONS',
		headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
	});
	check(
		'a CORS preflight gets no allow headers',
		!preflight.headers.has('access-control-allow-origin'),
		`status ${preflight.status}`
	);

	// Form content types are stopped first by SvelteKit's own CSRF check (403) when the Origin does not match.
	const formType = await fetch(`${base}/api/import`, {
		method: 'POST',
		headers: { 'content-type': 'text/plain' },
		body: deck
	});
	check(
		'a cross-site style text/plain POST is refused (403 from SvelteKit CSRF)',
		formType.status === 403 || formType.status === 415,
		`status ${formType.status}`
	);
	// Non-form types are not covered by SvelteKit's check, so this one proves our own guard (ADR-006).
	const octet = await fetch(`${base}/api/import`, {
		method: 'POST',
		headers: { 'content-type': 'application/octet-stream' },
		body: deck
	});
	check(
		'application/octet-stream is refused with 415',
		octet.status === 415,
		`status ${octet.status}`
	);
	const noType = await fetch(`${base}/api/import`, { method: 'POST' });
	check(
		'a POST with no content type is refused (403 or 415)',
		noType.status === 403 || noType.status === 415,
		`status ${noType.status}`
	);

	const dry = await fetch(`${base}/api/import?dry_run=true`, {
		method: 'POST',
		headers: json,
		body: deck
	});
	const dryBody: unknown = await dry.json();
	check(
		'dry run previews 8 new cards and writes nothing',
		dry.status === 200 && dig(dryBody, 'plan', 'counts', 'new') === 8
	);
	const noDecks: unknown = await (await fetch(`${base}/api/decks`)).json();
	check('no decks exist after a dry run', (dig(noDecks, 'decks') as unknown[]).length === 0);

	const first = await fetch(`${base}/api/import`, { method: 'POST', headers: json, body: deck });
	const firstBody: unknown = await first.json();
	check(
		'import commits 8 cards',
		first.status === 200 &&
			dig(firstBody, 'result', 'counts', 'new') === 8 &&
			dig(firstBody, 'result', 'changed') === true
	);

	const second = await fetch(`${base}/api/import`, { method: 'POST', headers: json, body: deck });
	const secondBody: unknown = await second.json();
	check(
		'importing the same deck again changes nothing',
		second.status === 200 &&
			dig(secondBody, 'result', 'changed') === false &&
			dig(secondBody, 'result', 'counts', 'unchanged') === 8
	);

	const decks: unknown = await (await fetch(`${base}/api/decks`)).json();
	check(
		'GET /api/decks lists the deck with its card count',
		(dig(decks, 'decks') as unknown[]).length === 1 &&
			dig(decks, 'decks', 0, 'id') === 'ccna-ospf' &&
			dig(decks, 'decks', 0, 'cardCount') === 8
	);

	// The study flow: get a card, answer it, and get the next card in the same response.
	const nextRes = await fetch(`${base}/api/study/next?deckId=ccna-ospf`);
	const nextBody: unknown = await nextRes.json();
	const firstItem = dig(nextBody, 'item') as Record<string, unknown> | undefined;
	check(
		'GET /api/study/next serves a new card with four grade labels',
		nextRes.status === 200 &&
			dig(nextBody, 'done') === false &&
			dig(firstItem, 'category') === 'new' &&
			dig(firstItem, 'previews', '3', 'label') === '10m' &&
			// 8 cards, but the two cloze cards have 3 and 2 blanks, and each blank is a review item.
			dig(nextBody, 'counts', 'new') === 11
	);
	const unknownDeck = await fetch(`${base}/api/study/next?deckId=nope`);
	check('an unknown deck is a 404 for study', unknownDeck.status === 404);

	const reviewPayload = {
		reviewId: 'smoke-review-000001',
		cardPk: dig(firstItem, 'cardPk'),
		ordinal: dig(firstItem, 'ordinal'),
		grade: 3,
		servedAt: dig(firstItem, 'servedAt'),
		deckId: 'ccna-ospf'
	};
	const reviewRes = await fetch(`${base}/api/study/review`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify(reviewPayload)
	});
	const reviewBody: unknown = await reviewRes.json();
	check(
		'POST /api/study/review records the answer and returns the next card',
		reviewRes.status === 200 &&
			dig(reviewBody, 'result', 'replayed') === false &&
			dig(reviewBody, 'result', 'next', 'phase') === 1 &&
			dig(reviewBody, 'next', 'done') === false &&
			dig(reviewBody, 'next', 'item', 'key') !== dig(firstItem, 'key')
	);
	const replay = await fetch(`${base}/api/study/review`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify(reviewPayload)
	});
	check(
		'repeating the same reviewId is idempotent',
		replay.status === 200 && dig(await replay.json(), 'result', 'replayed') === true
	);
	const invalidReview = await fetch(`${base}/api/study/review`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify({ ...reviewPayload, reviewId: 'smoke-review-000002', grade: 9 })
	});
	check('an invalid review is a 422', invalidReview.status === 422);

	const bad = await fetch(`${base}/api/import`, {
		method: 'POST',
		headers: json,
		body: '{ "tessera": 1, "deck": { "id": "x" }, "cards": [] }'
	});
	const badBody: unknown = await bad.json();
	const badErrors = (dig(badBody, 'error', 'details', 'errors') ?? []) as unknown[];
	check(
		'an invalid deck returns 422 with path-level errors',
		bad.status === 422 && badErrors.some((e) => dig(e, 'path') === 'deck.title')
	);

	// A deck over 512 KB proves BODY_SIZE_LIMIT is raised above adapter-node's default.
	const bigCards = Array.from({ length: 5000 }, (_, i) => ({
		id: `c${i}`,
		type: 'basic',
		front: `Question number ${i} about OSPF timers`,
		back: `Answer number ${i} with some explanatory text`
	}));
	const big = JSON.stringify({
		tessera: 1,
		deck: { id: 'big', title: 'Big deck' },
		cards: bigCards
	});
	check('the large test deck is over 512 KB', big.length > 512 * 1024, `${big.length} bytes`);
	const bigResponse = await fetch(`${base}/api/import`, {
		method: 'POST',
		headers: json,
		body: big
	});
	const bigBody: unknown = await bigResponse.json();
	check(
		'a 5,000 card deck imports (body limit is above 512 KB)',
		bigResponse.status === 200 && dig(bigBody, 'result', 'counts', 'new') === 5000,
		`status ${bigResponse.status}`
	);

	const huge = await fetch(`${base}/api/import`, {
		method: 'POST',
		headers: json,
		body: ' '.repeat(6 * 1024 * 1024)
	});
	check('a body over 5 MB is rejected with 413', huge.status === 413, `status ${huge.status}`);

	const missing = await fetch(`${base}/nope.json`);
	check('an unknown path is a 404', missing.status === 404);
} catch (error) {
	check(
		'smoke test ran to completion',
		false,
		error instanceof Error ? error.message : String(error)
	);
	if (output.length > 0) console.log('--- server output ---\n' + output.join('').slice(-2000));
} finally {
	if (child) {
		child.kill();
		await new Promise((r) => setTimeout(r, 300));
	}
	if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(failures === 0 ? '\nSmoke test passed' : `\nSmoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
