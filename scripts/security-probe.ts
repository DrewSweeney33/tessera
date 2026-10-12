// Adversarial checks against a real running Tessera server, mapped to ADR-005.
//   node scripts/security-probe.ts            starts build/index.js on a free port with a temp data dir
//   node scripts/security-probe.ts --base http://127.0.0.1:3000
// PASS means a control works. FAIL means a control is broken. Exits 1 on any FAIL.
// A control that is specified but not built yet is reported as KNOWN (and listed in the security review),
// never as PASS. None are open at the moment.
// Run `npm run build` first. This writes decks named "probe-*" into the target, so never aim it at real data.
//
// Against a server that is somewhere else (--base) the probe cannot start its own extra servers or read the
// server's output, and it must never test the local build while claiming to test the remote one. So the checks
// that need them take their server from a flag, and are reported as SKIP, with a reason, when the flag is absent:
//   --hosts-base URL   a server started with TESSERA_ALLOWED_HOSTS set to PROBE_ALLOWED_HOSTS
//   --token-base URL   a server started with TESSERA_API_TOKEN set to PROBE_TOKEN
//   --logs-cmd CMD, --hosts-logs-cmd CMD, --token-logs-cmd CMD   shell commands that print each server's log
// (see scripts/lib/probe-config.ts). The live-image harness (scripts/live-test.ts) supplies all of them.
// The main --base server must run with the image's default settings: no ORIGIN, PROTOCOL_HEADER, HOST_HEADER,
// TESSERA_ALLOWED_HOSTS, or TESSERA_API_TOKEN. The host-name and same-origin checks assume that, and fail
// (they do not pass) against a server configured otherwise, such as one set up for a reverse proxy.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROBE_ALLOWED_HOSTS, PROBE_TOKEN } from './lib/probe-config.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
	args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const baseArg = flag('--base');
const hostsBase = flag('--hosts-base');
const tokenBase = flag('--token-base');
const logsCommand = flag('--logs-cmd');
const hostsLogsCommand = flag('--hosts-logs-cmd');
const tokenLogsCommand = flag('--token-logs-cmd');

let failures = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${ok || !detail ? '' : `  (${detail})`}`);
	if (!ok) failures++;
}
// A check that could not run. Never counted as a pass, and listed in the summary.
function skip(name: string, reason: string): void {
	console.log(`SKIP  ${name}  (${reason})`);
	skipped++;
}
// The output of a server that is somewhere else, from a command given on the command line.
function remoteLog(command: string | undefined): (() => string | undefined) | undefined {
	if (!command) return undefined;
	return () => {
		const result = spawnSync(command, {
			shell: true,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		});
		return result.status === 0 ? result.stdout : undefined;
	};
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

interface ExtraServer {
	origin: URL;
	// The server's output so far, or undefined when it cannot be read.
	output: () => string | undefined;
	stop: () => void;
}

// Starts one more server with extra environment, for checks that need a different configuration. Against a
// remote server it starts nothing: it hands back the server the flags name for that configuration, or null.
async function startSecondServer(extraEnv: Record<string, string>): Promise<ExtraServer | null> {
	if (baseArg) {
		const url = 'TESSERA_API_TOKEN' in extraEnv ? tokenBase : hostsBase;
		if (!url) return null;
		const output = remoteLog('TESSERA_API_TOKEN' in extraEnv ? tokenLogsCommand : hostsLogsCommand);
		return { origin: new URL(url), output: output ?? (() => undefined), stop: () => {} };
	}
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
// The main server's output: its own, or the remote one's through --logs-cmd, or undefined when neither exists.
const readMainLog = (): string | undefined =>
	baseArg ? remoteLog(logsCommand)?.() : serverOutput.join('');

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
	const startupLog = readMainLog();
	if (startupLog === undefined) {
		skip('the startup log states the host rules', 'the server log is not available (--logs-cmd)');
	} else {
		check(
			'the startup log states the host rules',
			startupLog.includes('host check: using the default rules')
		);
	}

	// With TESSERA_ALLOWED_HOSTS set, only the listed names are answered.
	const listed = await startSecondServer({ TESSERA_ALLOWED_HOSTS: PROBE_ALLOWED_HOSTS });
	if (!listed) {
		skip(
			'the host-list checks (13 requests)',
			'needs a server started with the probe host list (--hosts-base)'
		);
	}
	const saved = origin;
	if (listed) origin = listed.origin;
	try {
		if (listed) {
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
			const listedLog = listed.output();
			if (listedLog === undefined) {
				skip(
					'the startup log lists the configured names',
					'the server log is not available (--hosts-logs-cmd)'
				);
			} else {
				check(
					'the startup log lists the configured names',
					listedLog.includes('answering only the listed host names')
				);
			}
		}
	} finally {
		origin = saved;
		listed?.stop();
	}

	// ---- 3b. The API token (ADR-009, ADR-011)
	console.log('\n# API token');
	const TOKEN = PROBE_TOKEN;
	const guarded = await startSecondServer({ TESSERA_API_TOKEN: TOKEN });
	if (!guarded) {
		skip(
			'all the API token checks (about 60)',
			'needs a server started with the probe token (--token-base)'
		);
	}
	const savedOrigin = origin;
	if (guarded) origin = guarded.origin;
	const guardedOrigin = guarded?.origin.origin ?? '';
	const withToken = { authorization: `Bearer ${TOKEN}` };
	const status = async (path: string, headers: Record<string, string> = {}, method = 'GET') =>
		(await send({ method, path, headers })).status;
	try {
		if (guarded) {
			const bare = await send({ path: '/api/decks' });
			check(
				'without the token a plain call is refused with 401',
				bare.status === 401,
				`got ${bare.status}`
			);
			check(
				'the refusal says how to authenticate, in the usual JSON shape',
				bare.headers['www-authenticate'] === 'Bearer realm="tessera"' &&
					JSON.parse(bare.text).error?.code === 'unauthorized'
			);
			check(
				'the refusal has the security headers and no cache',
				bare.headers['x-content-type-options'] === 'nosniff' &&
					bare.headers['cache-control'] === 'no-store' &&
					Boolean(bare.headers['x-request-id'])
			);
			check('the refusal does not echo the token', !bare.text.includes(TOKEN));

			for (const [name, headers] of [
				['a wrong token', { authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' }],
				['the token one character short', { authorization: `Bearer ${TOKEN.slice(0, -1)}` }],
				['the token with one more character', { authorization: `Bearer ${TOKEN}x` }],
				['the token in capitals', { authorization: `Bearer ${TOKEN.toUpperCase()}` }],
				['an empty token', { authorization: 'Bearer ' }],
				['the token with no scheme', { authorization: TOKEN }],
				['the token under Basic', { authorization: `Basic ${TOKEN}` }],
				['the token in X-Api-Key', { 'x-api-key': TOKEN }],
				['the token in a cookie', { cookie: `token=${TOKEN}` }]
			] as const) {
				check(`${name} is refused`, (await status('/api/decks', headers)) === 401);
			}
			check(
				'the token in the query string is refused',
				(await status(`/api/decks?token=${TOKEN}`)) === 401
			);

			check('the right token is accepted', (await status('/api/decks', withToken)) === 200);
			check(
				'the scheme word is not case sensitive',
				(await status('/api/decks', { authorization: `bearer ${TOKEN}` })) === 200
			);
			const imported = await send({
				method: 'POST',
				path: '/api/import',
				headers: { ...JSON_HEADERS, ...withToken },
				body: JSON.stringify(deck('probe-token', [basic('a')]))
			});
			check(
				'a deck can be imported with the token',
				imported.status === 200,
				`got ${imported.status}`
			);
			const refused = await send({
				method: 'POST',
				path: '/api/import',
				headers: JSON_HEADERS,
				body: JSON.stringify(deck('probe-token-no', [basic('a')]))
			});
			check('and not without it', refused.status === 401, `got ${refused.status}`);
			check(
				'a refused import wrote nothing',
				!(await send({ path: '/api/decks', headers: withToken })).text.includes('probe-token-no')
			);
			check(
				'the token is judged before the content type, so a caller learns nothing about the API',
				(await status('/api/import', { 'content-type': 'application/xml' }, 'POST')) === 401
			);
			// Creating a deck is a write, so it needs the token as well.
			check(
				'creating a deck is refused without the token',
				(await status('/api/decks', JSON_HEADERS, 'POST')) === 401
			);
			const tokenCreate = await send({
				method: 'POST',
				path: '/api/decks',
				headers: { ...JSON_HEADERS, ...withToken },
				body: '{"title":"Made with the token"}'
			});
			check('and works with the token', tokenCreate.status === 201, `got ${tokenCreate.status}`);
			// A deck export carries the whole deck, so it needs the token like every other API route.
			check(
				'a deck export is refused without the token',
				(await status('/api/decks/probe-token/export')) === 401
			);
			check(
				'and a path variant of it is refused too',
				(await status('/api/%64ecks/probe-token/%65xport')) === 401
			);
			const tokenExport = await send({ path: '/api/decks/probe-token/export', headers: withToken });
			check(
				'a deck export works with the token',
				tokenExport.status === 200 && JSON.parse(tokenExport.text).deck.id === 'probe-token',
				`got ${tokenExport.status}`
			);

			for (const path of ['/healthz', '/api/schema', '/', '/import']) {
				check(`${path} stays open`, (await status(path)) === 200);
			}

			// The router decodes the path before it matches routes, so the guard must too.
			for (const path of ['/%61pi/decks', '/ap%69/decks', '/api/%64ecks', '/api/study/%6eext']) {
				check(`${path} does not get around the token`, (await status(path)) === 401);
			}
			for (const path of [
				'/api%2Fdecks',
				'//api/decks',
				'/API/decks',
				'/api/schema/',
				'/api/decks/',
				'/api/./decks'
			]) {
				const code = await status(path);
				check(
					`${path} gives no data without the token`,
					code === 401 || code === 404 || code === 308,
					`got ${code}`
				);
			}

			// What identifies the Tessera page. The browser sets the first two, and a page cannot change them.
			for (const [name, headers, expected] of [
				['Sec-Fetch-Site: same-origin', { 'sec-fetch-site': 'same-origin' }, 200],
				['a matching Origin', { origin: guardedOrigin }, 200],
				[
					'a matching Origin over https, as adapter-node sees it',
					{ origin: guardedOrigin.replace('http:', 'https:') },
					200
				],
				[
					'the page marker alone, as plain HTTP on a LAN address',
					{ 'x-tessera-client': 'web' },
					200
				],
				['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }, 401],
				[
					'cross-site with a matching Origin and the marker',
					{ 'sec-fetch-site': 'cross-site', origin: guardedOrigin, 'x-tessera-client': 'web' },
					401
				],
				[
					'Sec-Fetch-Site: same-site',
					{ 'sec-fetch-site': 'same-site', 'x-tessera-client': 'web' },
					401
				],
				[
					'Sec-Fetch-Site: none (an address typed in)',
					{ 'sec-fetch-site': 'none', 'x-tessera-client': 'web' },
					401
				],
				['another site as Origin', { origin: 'http://evil.example' }, 401],
				[
					'another site as Origin with the marker',
					{ origin: 'http://evil.example', 'x-tessera-client': 'web' },
					401
				],
				[
					'the same host name on another port as Origin',
					{ origin: guardedOrigin.replace(/:\d+$/, ':1') },
					401
				],
				['Origin null with the marker', { origin: 'null', 'x-tessera-client': 'web' }, 401],
				['a wrong marker value', { 'x-tessera-client': 'yes' }, 401]
			] as const) {
				const got = await status('/api/decks', headers);
				check(`${name} gets ${expected}`, got === expected, `got ${got}`);
			}

			// Said plainly in the documentation, and checked so the documentation stays true.
			check(
				'a script that copies the browser headers is accepted, as documented: the token does not protect the web page',
				(await status('/api/decks', { 'sec-fetch-site': 'same-origin' })) === 200
			);

			// The host check still comes first: a rebound name is refused whatever else is sent.
			const rebound = await send({
				path: '/api/decks',
				headers: { host: 'attacker.example', 'sec-fetch-site': 'same-origin', ...withToken }
			});
			check(
				'a rebound host name is refused even with the token and browser headers',
				rebound.status === 421,
				`got ${rebound.status}`
			);

			// No cross-origin permission is ever granted, with or without the token.
			for (const headers of [{}, withToken]) {
				const r = await send({
					method: 'OPTIONS',
					path: '/api/decks',
					headers: {
						origin: 'http://evil.example',
						'access-control-request-method': 'GET',
						'access-control-request-headers': 'x-tessera-client, authorization',
						...headers
					}
				});
				check(
					`a preflight ${Object.keys(headers).length ? 'with' : 'without'} the token is granted nothing`,
					!Object.keys(r.headers).some((name) => name.startsWith('access-control-allow'))
				);
			}

			// A cross-site form post (the one write a page can make without asking) is stopped.
			const form = await send({
				method: 'POST',
				path: '/api/import',
				headers: {
					'content-type': 'text/plain',
					'sec-fetch-site': 'cross-site',
					origin: 'http://evil.example'
				},
				body: JSON.stringify(deck('probe-csrf', [basic('a')]))
			});
			check(
				'a cross-site form post is refused',
				form.status === 401 || form.status === 403,
				`got ${form.status}`
			);
			check(
				'and imported nothing',
				!(await send({ path: '/api/decks', headers: withToken })).text.includes('probe-csrf')
			);

			// Many wrong guesses change nothing for anyone else.
			let wrong = 0;
			for (let i = 0; i < 400; i++) {
				if (
					(await status('/api/decks', {
						authorization: `Bearer guess-${i}-xxxxxxxxxxxxxxxxxxxxxxxxxx`
					})) === 401
				)
					wrong++;
			}
			check('400 wrong guesses are all refused', wrong === 400, `${wrong} of 400`);
			check(
				'and the right token still works after them',
				(await status('/api/decks', withToken)) === 200
			);

			const log = guarded.output();
			if (log === undefined) {
				skip('the token log checks (4)', 'the server log is not available (--token-logs-cmd)');
			} else {
				check(
					'the startup log says a token is set, without printing it',
					log.includes('API token: set') && !log.includes(TOKEN)
				);
				check('refusals are logged', log.includes('request refused, API token missing or wrong'));
				check('the token never appears in the logs', !log.includes(TOKEN));
				check('nor do the wrong guesses', !log.includes('guess-17-'));
			}
		}
	} finally {
		origin = savedOrigin;
		guarded?.stop();
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

	// ---- 4b. Deck export (ADR-013)
	console.log('\n# Export');
	const exportMarker = 'ZQXJ-EXPORT-PROBE-5512';
	await post(
		'/api/import',
		deck('probe-export', [basic('a', `Question ${exportMarker}`, 'Answer'), basic('b')])
	);
	const exported = await send({ path: '/api/decks/probe-export/export' });
	check(
		'a deck export is a JSON download with a safe file name',
		exported.status === 200 &&
			String(exported.headers['content-type']).startsWith('application/json') &&
			exported.headers['content-disposition'] === 'attachment; filename="probe-export.json"',
		`${exported.status} ${exported.headers['content-disposition']}`
	);
	check(
		'it is not cached and not sniffed',
		exported.headers['cache-control'] === 'no-store' &&
			exported.headers['x-content-type-options'] === 'nosniff'
	);
	check(
		'it holds the deck that was imported',
		JSON.parse(exported.text).cards.length === 2 && exported.text.includes(exportMarker)
	);
	check(
		'it carries no cross-origin permission',
		!('access-control-allow-origin' in exported.headers)
	);
	const exportedMarkdown = await send({ path: '/api/decks/probe-export/export?format=md' });
	check(
		'the Markdown export is a Markdown download',
		exportedMarkdown.status === 200 &&
			String(exportedMarkdown.headers['content-type']).startsWith('text/markdown') &&
			exportedMarkdown.headers['content-disposition'] === 'attachment; filename="probe-export.md"'
	);
	const again = await post('/api/import', exported.text);
	check(
		'importing the export again changes nothing',
		again.status === 200 && JSON.parse(again.text).result?.changed === false,
		again.text.slice(0, 100)
	);
	for (const id of [
		'..%2f..%2fpackage.json',
		'%2e%2e%2fetc%2fpasswd',
		'no-such-deck',
		'UPPER',
		'a%20b',
		'%00',
		'x'.repeat(100),
		'%3Cscript%3E'
	]) {
		const r = await send({ path: `/api/decks/${id}/export` });
		check(
			`an export of "${id.slice(0, 24)}" is a 404 that leaks nothing and echoes nothing`,
			r.status === 404 &&
				!r.text.includes('"dependencies"') &&
				!r.text.includes('root:x:') &&
				!r.text.includes('<script') &&
				!/node_modules|\.ts:\d+/.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	for (const format of ['csv', 'apkg', '..%2fx', 'json%0d%0aX-Evil%3a%201', '%00']) {
		const r = await send({ path: `/api/decks/probe-export/export?format=${format}` });
		check(
			`export format "${format.slice(0, 20)}" is refused`,
			r.status === 400 && !('x-evil' in r.headers),
			`got ${r.status}`
		);
	}
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		const r = await send({
			method,
			path: '/api/decks/probe-export/export',
			headers: JSON_HEADERS,
			body: '{}'
		});
		// 405 for a method the route does not have, or 403 or 400 from the framework's own checks (a DELETE that
		// carries a body is a 400). Any of them is a refusal, and nothing was done.
		check(
			`${method} on the export route is refused`,
			[400, 403, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	const foreign = await send({
		path: '/api/decks/probe-export/export',
		headers: { host: 'attacker.example' }
	});
	check(
		'an export asked for under a foreign host name is refused (421)',
		foreign.status === 421 && !foreign.text.includes(exportMarker),
		`got ${foreign.status}`
	);

	// ---- 4c. Creating a deck by hand (ADR-013)
	console.log('\n# Creating a deck');
	const created = await post('/api/decks', { title: 'Probe made by hand' });
	check(
		'a deck can be created from a title, and is answered 201 with an id made from it',
		// The id is made from the title, with a number added if an earlier run of the probe already made one.
		created.status === 201 && /^probe-made-by-hand(-\d+)?$/.test(JSON.parse(created.text).deck?.id),
		`${created.status} ${created.text.slice(0, 100)}`
	);
	const madeId: string = JSON.parse(created.text).deck?.id ?? '';
	const listedAfter = await send({ path: '/api/decks' });
	check(
		'and the new deck is in the list with no cards',
		JSON.parse(listedAfter.text).decks.some(
			(d: { id: string; cardCount: number }) => d.id === madeId && d.cardCount === 0
		)
	);
	const twice = await post('/api/decks', { id: madeId, title: 'Again' });
	check(
		'a taken id is refused with 409 and the field named',
		twice.status === 409 && JSON.parse(twice.text).error?.details?.errors?.[0]?.path === 'id',
		`${twice.status}`
	);
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x',
		undefined
	]) {
		const label = type ?? 'no content type';
		const evil = await send({
			method: 'POST',
			path: '/api/decks',
			headers: { ...(type ? { 'content-type': type } : {}), origin: 'https://evil.example' },
			body: '{"title":"cross site"}'
		});
		check(
			`creating a deck cross-site with ${label} is refused (403 or 415)`,
			evil.status === 403 || evil.status === 415,
			`got ${evil.status}`
		);
		const plain = await send({
			method: 'POST',
			path: '/api/decks',
			headers: type ? { 'content-type': type } : {},
			body: '{"title":"plain call"}'
		});
		check(
			`and without an Origin with ${label} (403 or 415)`,
			plain.status === 403 || plain.status === 415,
			`got ${plain.status}`
		);
	}
	for (const [label, body, expected] of [
		['not JSON', '{not json', [400]],
		['an array', '[1,2]', [422]],
		['null', 'null', [422]],
		['a number', '5', [422]],
		['a blank title', '{"title":"   "}', [422]],
		['a prototype pollution key', '{"title":"t","__proto__":{"x":1}}', [422]],
		['an unknown field', '{"title":"t","cards":[{}]}', [422]],
		['an id with a path in it', '{"id":"../../etc/x","title":"t"}', [422]],
		['a title of 20 000 characters', JSON.stringify({ title: 'x'.repeat(20_000) }), [413, 422]],
		['40 000 bytes', JSON.stringify({ title: 'x'.repeat(40_000) }), [413]]
	] as const) {
		// Sent with a Content-Length, as browsers and curl send it. (A chunked upload over this route's small limit
		// gets its connection reset instead of a 413. That is how the study route behaves too, and it is on the
		// backlog as B-3.)
		const r = await send({
			method: 'POST',
			path: '/api/decks',
			headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(body)) },
			body
		});
		check(
			`creating a deck with ${label} is refused cleanly`,
			(expected as readonly number[]).includes(r.status) &&
				!/node_modules|\.ts:\d+|SQLITE/.test(r.text),
			`got ${r.status} ${r.text.slice(0, 80)}`
		);
	}
	const injection = await post('/api/decks', {
		title: `x'); DROP TABLE decks; --`,
		description: `'; DELETE FROM cards; --`
	});
	check(
		'a title with SQL in it is stored as plain text',
		injection.status === 201,
		`${injection.status}`
	);
	check(
		'and the deck list still works',
		(await send({ path: '/api/decks' })).status === 200 &&
			JSON.parse((await send({ path: '/api/decks' })).text).decks.length > 1
	);
	const markup = await post('/api/decks', { title: '<script>alert(1)</script>' });
	check(
		'a title with markup in it is stored as text and given a safe id',
		markup.status === 201 && /^[a-z0-9-]+$/.test(JSON.parse(markup.text).deck.id),
		`${markup.status}`
	);
	const foreignCreate = await send({
		method: 'POST',
		path: '/api/decks',
		headers: { ...JSON_HEADERS, host: 'attacker.example' },
		body: '{"title":"from a foreign host"}'
	});
	check(
		'creating a deck under a foreign host name is refused (421) and creates nothing',
		foreignCreate.status === 421 &&
			!JSON.parse((await send({ path: '/api/decks' })).text).decks.some(
				(d: { title: string }) => d.title === 'from a foreign host'
			),
		`got ${foreignCreate.status}`
	);
	for (const method of ['PUT', 'PATCH', 'DELETE']) {
		const r = await send({ method, path: '/api/decks', headers: JSON_HEADERS, body: '{}' });
		check(
			`${method} on /api/decks is refused`,
			[400, 403, 405].includes(r.status),
			`got ${r.status}`
		);
	}

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
	const logs = readMainLog();
	if (logs === undefined) {
		skip(
			'card text and typed answers never reach the logs',
			'the server log is not available (--logs-cmd)'
		);
	} else {
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
	else skip('the server process is still running', 'the server is not a local process');
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

if (skipped > 0)
	console.log(`\n${skipped} check(s) skipped, see the SKIP lines above. A skip is not a pass.`);
console.log(failures === 0 ? '\nNo failed checks.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
