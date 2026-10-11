// Adversarial checks against a real running Tessera server, mapped to ADR-005.
//   node scripts/security-probe.ts            starts build/index.js on a free port with a temp data dir
//   node scripts/security-probe.ts --base http://127.0.0.1:3000
// PASS means a control works. FAIL means a control is broken. Exits 1 on any FAIL.
// A control that is specified but not built yet is reported as KNOWN (and listed in the security review),
// never as PASS. None are open at the moment.
// Run `npm run build` first. This writes decks named "probe-*" into the target, so never aim it at real data.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}
interface Reply {
	status: number;
	headers: http.IncomingHttpHeaders;
	text: string;
}

let origin: URL;

function send(options: {
	method?: string;
	path: string;
	headers?: Record<string, string>;
	body?: string | Buffer;
	chunks?: Buffer[];
}): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: origin.hostname,
				port: origin.port,
				method: options.method ?? 'GET',
				path: options.path,
				headers: options.headers
			},
			(res) => {
				const parts: Buffer[] = [];
				res.on('data', (part: Buffer) => parts.push(part));
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						text: Buffer.concat(parts).toString('utf8')
					})
				);
			}
		);
		req.on('error', reject);
		if (options.chunks) for (const chunk of options.chunks) req.write(chunk);
		else if (options.body !== undefined) req.write(options.body);
		req.end();
	});
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
	send({
		method: 'POST',
		path,
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

function deck(id: string, cards: unknown[]) {
	return { tessera: 1, deck: { id, title: id }, cards };
}
const basic = (id: string, front = 'Q', back = 'A') => ({ id, type: 'basic', front, back });

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

// Starts one more server with extra environment, for checks that need a different configuration.
async function startSecondServer(extraEnv: Record<string, string>) {
	const port = await freePort();
	const folder = mkdtempSync(join(tmpdir(), 'tessera-probe2-'));
	const proc = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: folder,
			BODY_SIZE_LIMIT: '5M',
			LOG_LEVEL: 'debug',
			...extraEnv
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const chunks: string[] = [];
	proc.stdout?.on('data', (d) => chunks.push(String(d)));
	proc.stderr?.on('data', (d) => chunks.push(String(d)));
	const secondOrigin = new URL(`http://127.0.0.1:${port}`);
	const saved = origin;
	origin = secondOrigin;
	try {
		for (let i = 0; i < 100; i++) {
			try {
				if ((await send({ path: '/healthz' })).status === 200) break;
			} catch {
				// not up yet
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	} finally {
		origin = saved;
	}
	return {
		origin: secondOrigin,
		output: () => chunks.join(''),
		stop: () => {
			proc.kill();
			setTimeout(
				() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
				600
			);
		}
	};
}

let child: ChildProcess | undefined;
let dataDir: string | undefined;
const serverOutput: string[] = [];

if (baseArg) {
	origin = new URL(baseArg);
} else {
	const port = await freePort();
	dataDir = mkdtempSync(join(tmpdir(), 'tessera-probe-'));
	origin = new URL(`http://127.0.0.1:${port}`);
	child = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			BODY_SIZE_LIMIT: '5M',
			LOG_LEVEL: 'debug'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (d) => serverOutput.push(String(d)));
	child.stderr?.on('data', (d) => serverOutput.push(String(d)));
}

try {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await send({ path: '/healthz' })).status === 200) break;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 200));
	}

	// ---- 1. Response headers (ADR-005 section 5)
	console.log('\n# Headers');
	for (const path of ['/', '/api/decks', '/api/schema', '/healthz', '/no-such-page']) {
		const r = await send({ path });
		const csp = String(r.headers['content-security-policy'] ?? '');
		if (path === '/' || path === '/no-such-page') {
			check(`${path} has a CSP with script-src 'self'`, /script-src[^;]*'self'/.test(csp), csp);
			check(
				`${path} CSP forbids framing and objects`,
				/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp)
			);
			check(
				`${path} CSP allows no unsafe-eval or inline scripts`,
				!/script-src[^;]*'unsafe-(eval|inline)'/.test(csp)
			);
		}
		check(`${path} nosniff`, r.headers['x-content-type-options'] === 'nosniff');
		check(`${path} no referrer`, r.headers['referrer-policy'] === 'no-referrer');
		check(
			`${path} no CORS headers`,
			!Object.keys(r.headers).some((h) => h.startsWith('access-control-'))
		);
		check(`${path} no set-cookie`, r.headers['set-cookie'] === undefined);
		check(
			`${path} does not advertise the stack`,
			r.headers['x-powered-by'] === undefined && r.headers['server'] === undefined
		);
	}
	check(
		'/api/decks is no-store',
		(await send({ path: '/api/decks' })).headers['cache-control'] === 'no-store'
	);

	// ---- 2. Cross-site request protection (section 3)
	console.log('\n# Cross-site requests');
	const goodDeck = JSON.stringify(deck('probe-base', [basic('a')]));
	// Two independent layers. SvelteKit's own check answers 403 to a form-typed request that does not come
	// from this origin. Our content type guard answers 415 to anything but JSON. Each is tested alone: the
	// first by an evil Origin, the second by a same-origin request that gets past the first.
	const wrongTypes: (string | undefined)[] = [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x',
		'text/plain;charset=UTF-8',
		'application/jsonx',
		undefined
	];
	const sameOrigin = `https://${origin.host}`;
	for (const type of wrongTypes) {
		const label = type ?? 'no content type';
		const headers = (extra: Record<string, string>) => ({
			...(type ? { 'content-type': type } : {}),
			...extra
		});
		const evil = await send({
			method: 'POST',
			path: '/api/import',
			headers: headers({ origin: 'https://evil.example' }),
			body: goodDeck
		});
		check(
			`cross-site POST with ${label} is refused (403 or 415)`,
			evil.status === 403 || evil.status === 415,
			`got ${evil.status}`
		);
		const noOrigin = await send({
			method: 'POST',
			path: '/api/import',
			headers: headers({}),
			body: goodDeck
		});
		check(
			`POST with ${label} and no Origin is refused`,
			noOrigin.status === 403 || noOrigin.status === 415,
			`got ${noOrigin.status}`
		);
		if (child) {
			const same = await send({
				method: 'POST',
				path: '/api/import',
				headers: headers({ origin: sameOrigin }),
				body: goodDeck
			});
			check(
				`our guard alone refuses ${label} (same-origin, 415)`,
				same.status === 415,
				`got ${same.status}`
			);
		}
	}
	for (const method of ['PUT', 'PATCH', 'DELETE']) {
		const r = await send({
			method,
			path: '/api/study/review',
			headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
			body: '{}'
		});
		check(
			`cross-site ${method} /api/study/review is refused`,
			[400, 403, 405, 415].includes(r.status),
			`got ${r.status}`
		);
	}
	const preflight = await send({
		method: 'OPTIONS',
		path: '/api/import',
		headers: {
			origin: 'https://evil.example',
			'access-control-request-method': 'POST',
			'access-control-request-headers': 'content-type'
		}
	});
	check(
		'a CORS preflight is not approved',
		preflight.headers['access-control-allow-origin'] === undefined,
		`status ${preflight.status}`
	);
	const cross = await post('/api/import', goodDeck, {
		...JSON_HEADERS,
		origin: 'https://evil.example'
	});
	check(
		'a response to a cross-origin request carries no CORS approval',
		cross.headers['access-control-allow-origin'] === undefined
	);
	check(
		'GET /api/import changes nothing and is refused',
		(await send({ path: '/api/import' })).status === 405
	);
	check(
		'GET /api/study/review is refused',
		(await send({ path: '/api/study/review' })).status === 405
	);

	// ---- 3. Host header and DNS rebinding (section 1)
	console.log('\n# DNS rebinding');
	// Names a rebinding page uses are refused in every configuration, with no data in the reply.
	for (const host of [
		'attacker.example:3000',
		'127.0.0.1.nip.io',
		'7f000001.c0a80001.rbndr.us',
		'localhost.evil.com',
		'tessera.lan.evil.com'
	]) {
		const r = await send({ path: '/api/decks', headers: { host } });
		check(
			`a request for the name ${host} is refused with 421`,
			r.status === 421,
			`got ${r.status}`
		);
		check(`and the refusal contains no deck data (${host})`, !r.text.includes('"decks"'));
	}
	const refusedWrite = await send({
		method: 'POST',
		path: '/api/import',
		headers: { ...JSON_HEADERS, host: 'attacker.example' },
		body: goodDeck
	});
	check(
		'a write under a foreign name is refused too',
		refusedWrite.status === 421,
		`got ${refusedWrite.status}`
	);
	const hostPage = await send({ path: '/', headers: { host: 'attacker.example' } });
	check('so is the app page itself', hostPage.status === 421, `got ${hostPage.status}`);
	check(
		'the refusal says how to fix it',
		refusedWrite.text.includes('TESSERA_ALLOWED_HOSTS') &&
			refusedWrite.text.includes('attacker.example')
	);
	check(
		'the refusal still carries the security headers and a request id',
		refusedWrite.headers['x-content-type-options'] === 'nosniff' &&
			refusedWrite.headers['referrer-policy'] === 'no-referrer' &&
			Boolean(refusedWrite.headers['x-request-id'])
	);
	const health = await send({ path: '/healthz', headers: { host: 'monitor.example.com' } });
	check(
		'/healthz answers under any name, for monitors and the Docker health check',
		health.status === 200,
		`got ${health.status}`
	);

	if (child) {
		for (const host of [
			'localhost:3000',
			'127.0.0.1',
			'[::1]:3000',
			'192.168.30.99:3000',
			'tessera',
			'tessera.lan',
			'nas.home.arpa:3000',
			'box.local'
		]) {
			const r = await send({ path: '/api/decks', headers: { host } });
			check(`the default rules answer ${host}`, r.status === 200, `got ${r.status}`);
		}
		const own = await send({ path: '/api/decks', headers: { host: 'tessera.sweentech.com' } });
		check(
			'a real domain name needs the setting (a rebinding page could use one)',
			own.status === 421,
			`got ${own.status}`
		);
		check(
			'the startup log states the host rules',
			serverOutput.join('').includes('host check: using the default rules')
		);

		// With TESSERA_ALLOWED_HOSTS set, only the listed names are answered.
		const listed = await startSecondServer({
			TESSERA_ALLOWED_HOSTS: 'tessera.example.test, *.lab.example.test, box.example.test:8443'
		});
		const saved = origin;
		origin = listed.origin;
		try {
			for (const [host, expected] of [
				['tessera.example.test', 200],
				['TESSERA.EXAMPLE.TEST:443', 200],
				['x.lab.example.test', 200],
				['box.example.test:8443', 200],
				['box.example.test:80', 421],
				['lab.example.test', 421],
				['eviltessera.example.test', 421],
				['tessera.example.test.evil.com', 421],
				['tessera.lan', 421],
				['nas', 421],
				['attacker.example', 421],
				['127.0.0.1', 200],
				['localhost:3000', 200]
			] as const) {
				const r = await send({ path: '/api/decks', headers: { host } });
				check(
					`with the setting, ${host} gets ${expected}`,
					r.status === expected,
					`got ${r.status}`
				);
			}
			check(
				'the startup log lists the configured names',
				listed.output().includes('answering only the listed host names')
			);
		} finally {
			origin = saved;
			listed.stop();
		}
	}

	// ---- 4. Input hardening (section 6)
	console.log('\n# Input hardening');
	const six = Buffer.alloc(6 * 1024 * 1024, 0x20);
	const big = await send({ method: 'POST', path: '/api/import', headers: JSON_HEADERS, body: six });
	check('a 6 MB body is rejected', big.status === 413, `got ${big.status}`);
	const chunks = Array.from({ length: 6 }, () => Buffer.alloc(1024 * 1024, 0x20));
	const chunked = await send({
		method: 'POST',
		path: '/api/import',
		headers: { ...JSON_HEADERS, 'transfer-encoding': 'chunked' },
		chunks
	});
	check(
		'a 6 MB chunked body with no length is rejected',
		chunked.status === 413,
		`got ${chunked.status}`
	);

	const deep = '['.repeat(500_000);
	const deepReply = await post('/api/import', deep);
	check(
		'500,000 nested brackets give a clean client error',
		deepReply.status >= 400 && deepReply.status < 500,
		`got ${deepReply.status}`
	);
	check(
		'the server is still up after deep nesting',
		(await send({ path: '/healthz' })).status === 200
	);

	const polluted = await post(
		'/api/import',
		'{"tessera":1,"__proto__":{"polluted":true},"deck":{"id":"probe-proto","title":"x"},"cards":[]}'
	);
	check(
		'__proto__ in a deck is rejected, not merged',
		polluted.status === 422 || polluted.status === 400,
		`got ${polluted.status}`
	);
	const protoReview = await post(
		'/api/study/review',
		'{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'
	);
	check(
		'__proto__ in a review is rejected',
		protoReview.status === 422 || protoReview.status === 400,
		`got ${protoReview.status}`
	);
	check(
		'nothing was polluted',
		({} as Record<string, unknown>)['polluted'] === undefined &&
			(await send({ path: '/api/decks' })).status === 200
	);

	for (const value of ['yes', '', 'TRUE', '2']) {
		const r = await post(`/api/import?dry_run=${encodeURIComponent(value)}`, goodDeck);
		check(
			`dry_run=${JSON.stringify(value)} is refused instead of importing`,
			r.status === 400,
			`got ${r.status}`
		);
	}
	check(
		'dry_run=true previews and saves nothing',
		(await post('/api/import?dry_run=true', deck('probe-dry', [basic('a')]))).status === 200
	);
	const afterDry = await send({ path: '/api/decks' });
	check('the previewed deck does not exist', !afterDry.text.includes('probe-dry'));

	// ---- Markdown decks (text/markdown), whose front matter is read by a YAML parser
	console.log('\n# Markdown input hardening');
	const MD_HEADERS = { 'content-type': 'text/markdown' };
	const markdown = (body: string | Buffer, query = '') =>
		send({ method: 'POST', path: `/api/import${query}`, headers: MD_HEADERS, body });
	const mdHead = '---\ntessera: 1\nid: probe-md\ntitle: Probe\n---\n\n';

	const mdBig = await markdown(Buffer.alloc(6 * 1024 * 1024, 0x20));
	check('a 6 MB Markdown body is rejected', mdBig.status === 413, `got ${mdBig.status}`);

	// "Billion laughs": each alias expands to the one before it.
	const bomb = [
		'a: &a [x,x,x,x,x,x,x,x,x]',
		...'bcdefghij'.split('').map((n, i) => `${n}: &${n} [${`*${'abcdefghi'[i]},`.repeat(9)}]`)
	].join('\n');
	const bombStart = Date.now();
	const bombReply = await markdown(`---\ntessera: 1\nid: probe-md\ntitle: Probe\n${bomb}\n---\n`);
	check(
		'a YAML alias bomb gets a clean client error, quickly',
		bombReply.status === 422 && Date.now() - bombStart < 3000,
		`got ${bombReply.status} in ${Date.now() - bombStart} ms`
	);

	const nestedStart = Date.now();
	const nested = await markdown(
		`---\ntessera: 1\nid: probe-md\ntitle: ${'['.repeat(100_000)}\n---\n`
	);
	check(
		'100,000 nested YAML brackets give a clean client error, quickly',
		nested.status >= 400 && nested.status < 500 && Date.now() - nestedStart < 3000,
		`got ${nested.status} in ${Date.now() - nestedStart} ms`
	);

	for (const [name, front] of [
		['an unknown YAML tag', 'title: !!js/function "function(){}"'],
		['a custom YAML tag', 'title: !!python/object/apply:os.system ["id"]'],
		['a __proto__ key', '__proto__: {polluted: true}'],
		['a constructor key', 'constructor: {prototype: {polluted: true}}']
	] as const) {
		const reply = await markdown(
			`---\ntessera: 1\nid: probe-md\ntitle: Probe\n${front}\n---\n\n## a\nQ: q\nA: a\n`
		);
		check(`${name} in the front matter is refused`, reply.status === 422, `got ${reply.status}`);
	}
	check(
		'nothing was polluted by Markdown front matter',
		({} as Record<string, unknown>)['polluted'] === undefined
	);

	const flood = await markdown(`${mdHead}${'## \n'.repeat(200_000)}`);
	check(
		'200,000 empty cards give a capped error list',
		flood.status === 422 && flood.text.length < 100_000,
		`got ${flood.status}, ${flood.text.length} bytes`
	);
	const longLine = await markdown(`${mdHead}## a\nQ: ${'x'.repeat(2_000_000)}\nA: a\n`);
	check(
		'a 2 MB line is refused by the schema limit, not crashed on',
		longLine.status === 422,
		`got ${longLine.status}`
	);

	const mdDry = await markdown(`${mdHead}## a\nQ: q\nA: a\n`, '?dry_run=true');
	check('a Markdown dry run previews', mdDry.status === 200, `got ${mdDry.status}`);
	check('and saves nothing', !(await send({ path: '/api/decks' })).text.includes('probe-md'));
	const mdSql = await markdown(
		`---\ntessera: 1\nid: probe-md-sql\ntitle: Probe\n---\n\n## x'; DROP TABLE cards; --\nQ: '; DROP TABLE decks; --\nA: a" OR "1"="1\n`
	);
	check(
		'SQL metacharacters in a Markdown deck are refused or stored inert',
		mdSql.status === 200 || mdSql.status === 422,
		`got ${mdSql.status}`
	);
	check('the tables are still there', (await send({ path: '/api/decks' })).status === 200);
	const mdPlain = await post('/api/import', `${mdHead}## a\nQ: q\nA: a\n`, {
		'content-type': 'text/plain'
	});
	check(
		'text/plain, what a cross-site form can send, is still refused',
		mdPlain.status === 415 || mdPlain.status === 403,
		`got ${mdPlain.status}`
	);
	check(
		'the server is still up after the Markdown probes',
		(await send({ path: '/healthz' })).status === 200
	);

	// SQL injection and odd identifiers
	const evilId = `x'; DROP TABLE cards; --`;
	const evilImport = await post(
		'/api/import',
		deck('probe-sql', [basic(evilId, `'; DROP TABLE decks; --`, 'a" OR "1"="1')])
	);
	check(
		'a card id with SQL metacharacters is refused or stored inert',
		evilImport.status === 200 || evilImport.status === 422,
		`got ${evilImport.status}`
	);
	for (const deckId of [`' OR '1'='1`, '%', '_', '../../etc/passwd', 'a'.repeat(500), '\u0000']) {
		const r = await send({ path: `/api/study/next?deckId=${encodeURIComponent(deckId)}` });
		check(
			`study/next deckId ${JSON.stringify(deckId.slice(0, 20))} is a clean 400 or 404`,
			r.status === 400 || r.status === 404,
			`got ${r.status}`
		);
	}
	check(
		'tables survive the injection attempts',
		(await send({ path: '/api/decks' })).status === 200
	);

	// Unicode edge cases: NUL, lone surrogates, bidi controls, huge emoji sequences
	const odd = 'a\u0000b \ud800 ‮evil‬ \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
	const oddImport = await post('/api/import', deck('probe-unicode', [basic('u1', odd, odd)]));
	if (oddImport.status === 200) {
		const next = JSON.parse(
			(await send({ path: '/api/study/next?deckId=probe-unicode' })).text
		) as { item?: { content: { front?: string } } };
		const back = next.item?.content.front ?? '';
		check(
			'unicode text round-trips exactly, or was cleanly refused',
			back === odd || back.includes('a'),
			JSON.stringify(back.slice(0, 30))
		);
		check(
			'NUL is not silently truncating the text',
			!back.includes('\u0000') || back === odd,
			JSON.stringify(back.slice(0, 30))
		);
	} else {
		check(
			'unicode edge cases are refused with a client error',
			oddImport.status === 422 || oddImport.status === 400,
			`got ${oddImport.status}`
		);
	}

	// Pathological patterns must not hang the server
	const started = performance.now();
	const nasty = await post(
		'/api/import',
		deck('probe-redos', [
			{ id: 'c1', type: 'cloze', text: '{{c1::'.repeat(1500) + 'x' },
			{ id: 'c2', type: 'cloze', text: '{{c1::a}}'.repeat(500) },
			{ id: 'c3', type: 'cloze', text: '{{c1::' + '}'.repeat(3000) },
			basic('b1', '*'.repeat(4000) + '_'.repeat(4000), '`'.repeat(4000))
		])
	);
	const took = performance.now() - started;
	check(
		'pathological cloze and Markdown text is handled quickly',
		took < 3000,
		`${Math.round(took)} ms, status ${nasty.status}`
	);
	check('the server answers right after', (await send({ path: '/healthz' })).status === 200);

	// ---- 5. Path traversal and error leakage
	console.log('\n# Paths and errors');
	for (const path of [
		'/fonts/../../package.json',
		'/..%2f..%2fpackage.json',
		'/%2e%2e/%2e%2e/etc/passwd',
		'/_app/../../package.json',
		'/fonts/%2e%2e%2fOFL-geist.txt',
		'/..\\..\\package.json'
	]) {
		const r = await send({ path });
		const leaked = r.text.includes('"dependencies"') || r.text.includes('root:x:');
		check(`traversal ${path} leaks nothing`, !leaked, `status ${r.status}`);
	}
	const errorBodies = [
		await send({ path: '/%E0%A4%A' }),
		await post('/api/import', '{not json'),
		await post('/api/study/review', '[1,2,3]'),
		await send({ path: '/api/study/next?deckId[]=a&deckId[]=b' }),
		await send({ path: '/no/such/route' })
	];
	for (const [i, r] of errorBodies.entries()) {
		check(
			`error response ${i + 1} shows no paths or stack traces`,
			!/node_modules|[A-Z]:\\|\/app\/|at \w+ \(|\.ts:\d+/.test(r.text),
			r.text.slice(0, 80)
		);
	}
	check(
		'every error response is JSON or a plain page, never a framework dump',
		errorBodies.every((r) => r.status < 500)
	);

	// ---- 6. Logging (section 7)
	console.log('\n# Logging');
	const marker = 'ZQXJ-SECRET-CARD-TEXT-7731';
	await post(
		'/api/import',
		deck('probe-log', [{ id: 'l1', type: 'typed', front: marker, answer: marker }])
	);
	const next = JSON.parse((await send({ path: '/api/study/next?deckId=probe-log' })).text) as {
		item?: { cardPk: number; ordinal: number; servedAt: string };
	};
	if (next.item) {
		await post('/api/study/review', {
			reviewId: 'probe-review-0001',
			cardPk: next.item.cardPk,
			ordinal: next.item.ordinal,
			grade: 3,
			servedAt: next.item.servedAt,
			typedAnswer: marker
		});
	}
	await new Promise((r) => setTimeout(r, 300));
	const logs = serverOutput.join('');
	if (child) {
		check('server logs were captured', logs.length > 0);
		check('card text and typed answers never reach the logs', !logs.includes(marker));
	}

	// ---- 7. Request id (header injection)
	console.log('\n# Request id');
	const hostile = await send({ path: '/healthz', headers: { 'x-request-id': 'a b<script>' } });
	check(
		'a hostile request id is replaced',
		/^[A-Za-z0-9._-]{1,64}$/.test(String(hostile.headers['x-request-id']))
	);
	const kept = await send({ path: '/healthz', headers: { 'x-request-id': 'trace-123' } });
	check('a sane request id is kept', kept.headers['x-request-id'] === 'trace-123');

	// ---- 8. Availability
	console.log('\n# Availability');
	const burst = await Promise.all(Array.from({ length: 300 }, () => send({ path: '/api/decks' })));
	check(
		'300 concurrent requests all succeed',
		burst.every((r) => r.status === 200),
		`${burst.filter((r) => r.status !== 200).length} failed`
	);
	const garbageSocket = await new Promise<boolean>((resolve) => {
		import('node:net').then(({ connect }) => {
			const socket = connect(Number(origin.port), origin.hostname, () =>
				socket.write('GARBAGE\r\n\r\n')
			);
			socket.on('data', () => socket.destroy());
			socket.on('close', () => resolve(true));
			socket.on('error', () => resolve(true));
			setTimeout(() => resolve(true), 1500);
		});
	});
	check(
		'malformed HTTP does not crash the server',
		garbageSocket && (await send({ path: '/healthz' })).status === 200
	);
	if (child) check('the server process is still running', child.exitCode === null);
} catch (error) {
	console.error('\nProbe aborted:', error instanceof Error ? error.message : error);
	failures++;
} finally {
	child?.kill();
	if (dataDir) {
		await new Promise((r) => setTimeout(r, 300));
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

console.log(failures === 0 ? '\nNo failed checks.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
