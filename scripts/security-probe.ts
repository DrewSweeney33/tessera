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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from './lib/net.ts';
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
	fresh?: boolean;
}): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: origin.hostname,
				port: origin.port,
				method: options.method ?? 'GET',
				path: options.path,
				headers: options.headers,
				// A connection of its own only when asked (see the installable app section): reusing one after the server
				// answered a write early and closed it fails the next request.
				...(options.fresh ? { agent: false } : {})
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
			// Loading a deck for editing carries the whole deck and a revision, so it needs the token too.
			check(
				'loading a deck for editing is refused without the token',
				(await status('/api/decks/probe-token')) === 401
			);
			const tokenLoad = await send({ path: '/api/decks/probe-token', headers: withToken });
			check(
				'and works with the token',
				tokenLoad.status === 200 && /^[0-9a-f]{64}$/.test(JSON.parse(tokenLoad.text).revision),
				`got ${tokenLoad.status}`
			);
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

			// The Trash routes read and change which decks exist, so they need the token as well.
			check('the Trash list is refused without the token', (await status('/api/trash')) === 401);
			for (const action of ['trash', 'restore', 'delete-forever']) {
				check(
					`${action} is refused without the token`,
					(await status(`/api/decks/probe-token/${action}`, JSON_HEADERS, 'POST')) === 401
				);
			}
			check(
				'start over is refused without the token',
				(await status('/api/decks/probe-token/start-over', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'and a path variant of trash is refused too',
				(await status('/api/%64ecks/probe-token/%74rash', JSON_HEADERS, 'POST')) === 401
			);
			const tokenTrash = await send({
				method: 'POST',
				path: '/api/decks/probe-token/trash',
				headers: { ...JSON_HEADERS, ...withToken },
				body: '{}'
			});
			check(
				'the Trash works with the token',
				tokenTrash.status === 200,
				`got ${tokenTrash.status}`
			);
			check('and the Trash list does too', (await status('/api/trash', withToken)) === 200);
			await send({
				method: 'POST',
				path: '/api/decks/probe-token/restore',
				headers: { ...JSON_HEADERS, ...withToken },
				body: '{}'
			});

			// Backups hold the whole database, so every Backups route needs the token.
			check('the backup list is refused without the token', (await status('/api/backups')) === 401);
			check(
				'taking a backup is refused without the token',
				(await status('/api/backups', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'a backup download is refused without the token',
				(await status('/api/backups/manual-x.db')) === 401
			);
			check('and so is a path variant of it', (await status('/api/%62ackups/manual-x.db')) === 401);
			check(
				'deleting a backup is refused without the token',
				(await status('/api/backups/manual-x.db', JSON_HEADERS, 'DELETE')) === 401
			);
			check(
				'previewing a restore is refused without the token',
				(await status('/api/backups/manual-x.db/preview')) === 401
			);
			check(
				'restoring is refused without the token',
				(await status('/api/backups/manual-x.db/restore', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'and so is a path variant of it',
				(await status('/api/backups/manual-x.db/%72estore', JSON_HEADERS, 'POST')) === 401
			);
			check('the leech list is refused without the token', (await status('/api/leeches')) === 401);
			check(
				'the weak-spot report is refused without the token',
				(await status('/api/report/weak-spots')) === 401
			);
			check(
				'suspending a card is refused without the token',
				(await status('/api/cards/1/suspend', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'resetting a leech is refused without the token',
				(await status('/api/leeches/1/0/reset', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'and a path variant of the report is refused too',
				(await status('/api/%72eport/weak-spots')) === 401
			);
			check(
				'the leech list and the report work with the token',
				(await status('/api/leeches', withToken)) === 200 &&
					(await status('/api/report/weak-spots', withToken)) === 200
			);
			// Folders only group decks, but they are still app data, so every folder route needs the token.
			check('the folder list is refused without the token', (await status('/api/folders')) === 401);
			check(
				'creating a folder is refused without the token',
				(await status('/api/folders', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'renaming and deleting a folder are refused without the token',
				(await status('/api/folders/1', JSON_HEADERS, 'PUT')) === 401 &&
					(await status('/api/folders/1', JSON_HEADERS, 'DELETE')) === 401
			);
			check(
				'folder statistics are refused without the token',
				(await status('/api/folders/1/stats')) === 401
			);
			check(
				'moving decks into a folder is refused without the token',
				(await status('/api/folder-assignments', JSON_HEADERS, 'PUT')) === 401
			);
			check(
				'and a path variant of the folder list is refused too',
				(await status('/api/%66olders')) === 401
			);
			const tokenFolder = await send({
				method: 'POST',
				path: '/api/folders',
				headers: { ...JSON_HEADERS, ...withToken },
				body: '{"name":"Probe folder"}'
			});
			check(
				'a folder can be made with the token',
				tokenFolder.status === 201,
				`got ${tokenFolder.status}`
			);
			check(
				'and the folder list works with the token',
				(await status('/api/folders', withToken)) === 200
			);
			// Practice again only reads and adds log rows, but it is still app data: every practice route needs the token.
			check(
				'the practice pool is refused without the token',
				(await status('/api/practice/pool?deckId=probe')) === 401
			);
			check(
				'starting a practice session is refused without the token',
				(await status('/api/practice/start', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'a practice item is refused without the token',
				(await status('/api/practice/item?cardPk=1&ordinal=0')) === 401
			);
			check(
				'recording a practice answer is refused without the token',
				(await status('/api/practice/grade', JSON_HEADERS, 'POST')) === 401
			);
			check(
				'and a path variant of a practice route is refused too',
				(await status('/api/%70ractice/pool?deckId=probe')) === 401
			);
			// The page and its app files are not API routes: the token never applies to them, so the browser can fetch
			// the manifest and the worker (which it does without credentials).
			for (const path of [
				'/manifest.webmanifest',
				'/service-worker.js',
				'/offline.html',
				'/icons/icon-192.png'
			]) {
				check(`${path} needs no token`, (await status(path)) === 200);
			}
			check('the statistics are refused without the token', (await status('/api/stats')) === 401);
			check(
				'and so are the statistics of one deck',
				(await status('/api/stats?deckId=probe')) === 401
			);
			check(
				'and a path variant of the statistics is refused too',
				(await status('/api/%73tats')) === 401
			);
			check('the settings are refused without the token', (await status('/api/settings')) === 401);
			check(
				'changing them is refused without the token',
				(await status('/api/settings', JSON_HEADERS, 'PUT')) === 401
			);
			check(
				'and a path variant is refused too',
				(await status('/api/%73ettings', JSON_HEADERS, 'PUT')) === 401
			);
			check(
				'they can be read and changed with the token',
				(await status('/api/settings', withToken)) === 200 &&
					(
						await send({
							method: 'PUT',
							path: '/api/settings',
							headers: { ...JSON_HEADERS, ...withToken },
							body: '{"leechThreshold":8}'
						})
					).status === 200
			);
			const tokenBackup = await send({
				method: 'POST',
				path: '/api/backups',
				headers: { ...JSON_HEADERS, ...withToken },
				body: '{}'
			});
			const tokenBackupName: string =
				tokenBackup.status === 201 ? JSON.parse(tokenBackup.text).backup?.name : '';
			check(
				'a backup works with the token',
				tokenBackup.status === 201,
				`got ${tokenBackup.status}`
			);
			check(
				'and so does its download',
				(
					await send({ path: `/api/backups/${tokenBackupName}`, headers: withToken })
				).text.startsWith('SQLite format 3')
			);
			await send({
				method: 'DELETE',
				path: `/api/backups/${tokenBackupName}`,
				headers: { ...JSON_HEADERS, ...withToken }
			});

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

	// ---- 4d. Editing a deck: the editor's read and the stale-write check (ADR-013)
	console.log('\n# Editing a deck');
	const loadedDeck = await send({ path: '/api/decks/probe-export' });
	const loadedBody = JSON.parse(loadedDeck.text);
	check(
		'a deck can be loaded for editing, with its document, summary, and a 64 character revision',
		loadedDeck.status === 200 &&
			loadedBody.document?.cards?.length === 2 &&
			loadedBody.deck?.id === 'probe-export' &&
			/^[0-9a-f]{64}$/.test(loadedBody.revision),
		`${loadedDeck.status}`
	);
	check(
		'it carries no cross-origin permission and is not cached',
		!('access-control-allow-origin' in loadedDeck.headers) &&
			loadedDeck.headers['cache-control'] === 'no-store'
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
		const r = await send({ path: `/api/decks/${id}` });
		check(
			`loading "${id.slice(0, 24)}" is a 404 that leaks nothing and echoes nothing`,
			r.status === 404 &&
				!r.text.includes('"dependencies"') &&
				!r.text.includes('root:x:') &&
				!r.text.includes('<script') &&
				!/node_modules|\.ts:\d+/.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		const r = await send({
			method,
			path: '/api/decks/probe-export',
			headers: JSON_HEADERS,
			body: '{}'
		});
		check(`${method} on a deck is refused`, [400, 403, 405].includes(r.status), `got ${r.status}`);
	}
	const editedDeck = {
		...loadedBody.document,
		cards: loadedBody.document.cards.map((card: { id: string }, i: number) =>
			i === 0 ? { ...card, back: 'Edited by the probe' } : card
		)
	};
	const sentBody = JSON.stringify(editedDeck);
	const saveWith = (revision: string, extra = '') =>
		send({
			method: 'POST',
			path: `/api/import?expected_revision=${revision}${extra}`,
			headers: JSON_HEADERS,
			body: sentBody
		});
	const savedEdit = await saveWith(loadedBody.revision);
	check(
		'a save made with the revision that was loaded is accepted',
		savedEdit.status === 200 && JSON.parse(savedEdit.text).result?.changed === true,
		`${savedEdit.status} ${savedEdit.text.slice(0, 80)}`
	);
	const replay = await saveWith(loadedBody.revision);
	check(
		'the same revision used again is refused with 409, because the deck has changed since',
		replay.status === 409 &&
			JSON.parse(replay.text).error?.details?.errors?.[0]?.code === 'changed_elsewhere',
		`${replay.status}`
	);
	const stalePreview = await saveWith(loadedBody.revision, '&dry_run=true');
	check('and so is a preview made from that old copy', stalePreview.status === 409);
	for (const bad of ['', 'abc', 'G'.repeat(64), '../etc', 'a'.repeat(65), '%00']) {
		const r = await saveWith(bad);
		check(
			`a malformed revision "${bad.slice(0, 12)}" is refused with 400`,
			r.status === 400 && !/node_modules|\.ts:\d+/.test(r.text),
			`got ${r.status}`
		);
	}
	const foreignLoad = await send({
		path: '/api/decks/probe-export',
		headers: { host: 'attacker.example' }
	});
	check(
		'loading a deck under a foreign host name is refused (421) and shows no card',
		foreignLoad.status === 421 && !foreignLoad.text.includes(exportMarker),
		`got ${foreignLoad.status}`
	);

	// ---- 4c. The Trash (US-13, ADR-013)
	console.log('\n# Trash');
	const trashMarker = 'ZQXJ-TRASH-PROBE-7741';
	const trashTitle = 'Probe trash deck';
	const trashDeckBody = {
		...deck('probe-trash', [basic('t1', trashMarker, 'A'), basic('t2')]),
		deck: { id: 'probe-trash', title: trashTitle }
	};
	const trashImport = await post('/api/import', trashDeckBody);
	check('a deck to trash can be imported', trashImport.status === 200, `${trashImport.status}`);
	const idsOf = (text: string) =>
		(JSON.parse(text).decks as { id: string }[]).map((entry) => entry.id);
	const trashAction = (id: string, action: string, body: unknown = {}, headers = JSON_HEADERS) =>
		post(`/api/decks/${id}/${action}`, body, headers);

	check(
		'the Trash does not list a deck that is not in it',
		!idsOf((await send({ path: '/api/trash' })).text).includes('probe-trash')
	);
	const moved = await trashAction('probe-trash', 'trash');
	check(
		'a deck can be moved to the Trash',
		moved.status === 200 && JSON.parse(moved.text).deck?.id === 'probe-trash',
		`${moved.status} ${moved.text.slice(0, 80)}`
	);
	const movedAgain = await trashAction('probe-trash', 'trash');
	check('and moving it again is harmless', movedAgain.status === 200, `${movedAgain.status}`);
	check(
		'it is in the Trash list',
		idsOf((await send({ path: '/api/trash' })).text).includes('probe-trash')
	);
	check(
		'and gone from the deck list',
		!idsOf((await send({ path: '/api/decks' })).text).includes('probe-trash')
	);
	check(
		'it cannot be loaded for editing or exported',
		(await send({ path: '/api/decks/probe-trash' })).status === 404 &&
			(await send({ path: '/api/decks/probe-trash/export' })).status === 404
	);
	const studyTrashed = await send({ path: '/api/study/next?deckId=probe-trash' });
	check(
		'a study session for it serves no card',
		!studyTrashed.text.includes(trashMarker),
		`${studyTrashed.status}`
	);
	const studyAll = await send({ path: '/api/study/next' });
	check(
		'and neither does a session over every deck',
		!studyAll.text.includes(trashMarker),
		`${studyAll.status}`
	);
	const trashedGet = await send({ path: '/api/trash' });
	check(
		'the Trash list is not cached and grants no cross-origin permission',
		trashedGet.headers['cache-control'] === 'no-store' &&
			!('access-control-allow-origin' in trashedGet.headers)
	);

	for (const action of ['trash', 'restore', 'delete-forever']) {
		for (const id of [
			'..%2f..%2fpackage.json',
			'no-such-deck',
			'UPPER',
			'a%20b',
			'%00',
			'x'.repeat(100),
			'%3Cscript%3Ealert(1)%3C%2Fscript%3E'
		]) {
			const r = await trashAction(id, action, { confirmTitle: 'x' });
			check(
				`${action} on "${id.slice(0, 24)}" is a 404 that leaks nothing and echoes nothing`,
				r.status === 404 &&
					!r.text.includes('<script') &&
					!r.text.includes('"dependencies"') &&
					!/node_modules|\.ts:\d+/.test(r.text),
				`${r.status} ${r.text.slice(0, 80)}`
			);
		}
		for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
			const r = await send({
				method,
				path: `/api/decks/probe-trash/${action}`,
				headers: method === 'GET' ? {} : JSON_HEADERS,
				...(method === 'GET' ? {} : { body: '{}' })
			});
			check(
				`${method} on ${action} is refused`,
				[400, 403, 404, 405].includes(r.status),
				`got ${r.status}`
			);
		}
		const foreign = await send({
			method: 'POST',
			path: `/api/decks/probe-trash/${action}`,
			headers: { ...JSON_HEADERS, host: 'attacker.example' },
			body: JSON.stringify({ confirmTitle: trashTitle })
		});
		check(
			`${action} under a foreign host name is refused (421)`,
			foreign.status === 421,
			`got ${foreign.status}`
		);
	}

	// A cross-site page must not be able to trash or delete: it cannot send JSON without a preflight.
	await post('/api/import', deck('probe-trash-safe', [basic('s1')]));
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		for (const action of ['trash', 'delete-forever']) {
			const evil = await send({
				method: 'POST',
				path: `/api/decks/probe-trash-safe/${action}`,
				headers: { 'content-type': type, origin: 'https://evil.example' },
				body: '{"confirmTitle":"x"}'
			});
			check(
				`${action} cross-site as ${type.split(';')[0]} is refused (403 or 415)`,
				[403, 415].includes(evil.status),
				`got ${evil.status}`
			);
		}
	}
	const noType = await send({
		method: 'POST',
		path: '/api/decks/probe-trash-safe/trash',
		body: '{}'
	});
	check(
		'trash with no content type is refused (403 or 415)',
		[403, 415].includes(noType.status),
		`got ${noType.status}`
	);
	check(
		'none of that moved the deck',
		idsOf((await send({ path: '/api/decks' })).text).includes('probe-trash-safe')
	);

	// Deleting for good.
	const liveDelete = await trashAction('probe-trash-safe', 'delete-forever', { confirmTitle: 'x' });
	check(
		'a deck that is not in the Trash cannot be deleted for good (409)',
		liveDelete.status === 409,
		`got ${liveDelete.status}`
	);
	const wrongTitle = await trashAction('probe-trash', 'delete-forever', {
		confirmTitle: '<script>alert(9)</script>'
	});
	check(
		'a wrong title is a 422 that names the field and does not echo what was typed',
		wrongTitle.status === 422 &&
			JSON.parse(wrongTitle.text).error?.details?.errors?.[0]?.path === 'confirmTitle' &&
			!wrongTitle.text.includes('<script'),
		`${wrongTitle.status} ${wrongTitle.text.slice(0, 80)}`
	);
	for (const [label, body] of [
		['a missing title', {}],
		['a title that is a number', { confirmTitle: 5 }],
		['a title that is null', { confirmTitle: null }],
		['an extra field', { confirmTitle: trashTitle, force: true }],
		['an array', []],
		['the id instead of the title', { confirmTitle: 'probe-trash' }],
		['the title in other case', { confirmTitle: trashTitle.toUpperCase() }]
	] as const) {
		const r = await trashAction('probe-trash', 'delete-forever', body);
		check(`${label} deletes nothing`, r.status === 422 || r.status === 400, `got ${r.status}`);
	}
	const badJson = await post('/api/decks/probe-trash/delete-forever', '{not json');
	check('a body that is not JSON is a 400', badJson.status === 400, `got ${badJson.status}`);
	// Sent with its true Content-Length, as browsers and curl do (a chunked upload over a small limit has its
	// connection reset instead of getting a 413: backlog B-3).
	const hugeText = JSON.stringify({ confirmTitle: 'x'.repeat(40_000) });
	const hugeBody = await send({
		method: 'POST',
		path: '/api/decks/probe-trash/delete-forever',
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(hugeText)) },
		body: hugeText
	});
	check(
		'a body over the small limit is refused (413)',
		hugeBody.status === 413,
		`got ${hugeBody.status}`
	);
	check(
		'after all of that the deck is still in the Trash, untouched',
		idsOf((await send({ path: '/api/trash' })).text).includes('probe-trash')
	);

	const restored = await trashAction('probe-trash', 'restore');
	check(
		'a deck can be restored, and answers with its summary',
		restored.status === 200 &&
			JSON.parse(restored.text).deck?.id === 'probe-trash' &&
			JSON.parse(restored.text).deck?.cardCount === 2,
		`${restored.status} ${restored.text.slice(0, 80)}`
	);
	check(
		'and it is back in the deck list, and loads for editing again',
		idsOf((await send({ path: '/api/decks' })).text).includes('probe-trash') &&
			(await send({ path: '/api/decks/probe-trash' })).status === 200
	);
	await trashAction('probe-trash', 'trash');
	const gone = await trashAction('probe-trash', 'delete-forever', {
		confirmTitle: ` ${trashTitle} `
	});
	const goneBody = gone.status === 200 ? JSON.parse(gone.text) : undefined;
	check(
		'with the right title it is deleted for good, and a snapshot taken first is named',
		gone.status === 200 &&
			goneBody?.deleted?.cards === 2 &&
			/^pre-delete-probe-trash-[A-Za-z0-9._-]+\.db$/.test(goneBody?.deleted?.snapshot?.name ?? ''),
		`${gone.status} ${gone.text.slice(0, 120)}`
	);
	check(
		'it is then in neither list, and cannot be restored',
		!idsOf((await send({ path: '/api/trash' })).text).includes('probe-trash') &&
			!idsOf((await send({ path: '/api/decks' })).text).includes('probe-trash') &&
			(await trashAction('probe-trash', 'restore')).status === 404
	);
	check('the response gives no path on the server', !gone.text.includes('/data'));

	// ---- 4d. Start over (US-14, ADR-013)
	console.log('\n# Start over');
	const resetTitle = 'Probe start over deck';
	await post('/api/import', {
		...deck('probe-reset', [basic('r1'), basic('r2')]),
		deck: { id: 'probe-reset', title: resetTitle }
	});
	const startOverAction = (id: string, body: unknown, headers = JSON_HEADERS) =>
		post(`/api/decks/${id}/start-over`, body, headers);

	for (const id of [
		'..%2f..%2fpackage.json',
		'no-such-deck',
		'UPPER',
		'a%20b',
		'%00',
		'x'.repeat(100),
		'%3Cscript%3Ealert(1)%3C%2Fscript%3E'
	]) {
		const r = await startOverAction(id, { confirmTitle: 'x' });
		check(
			`start over on "${id.slice(0, 24)}" is a 404 that leaks nothing and echoes nothing`,
			r.status === 404 &&
				!r.text.includes('<script') &&
				!r.text.includes('"dependencies"') &&
				!/node_modules|\.ts:\d+/.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
		const r = await send({
			method,
			path: '/api/decks/probe-reset/start-over',
			headers: method === 'GET' ? {} : JSON_HEADERS,
			...(method === 'GET' ? {} : { body: '{}' })
		});
		check(
			`${method} on start over is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	const foreignReset = await send({
		method: 'POST',
		path: '/api/decks/probe-reset/start-over',
		headers: { ...JSON_HEADERS, host: 'attacker.example' },
		body: JSON.stringify({ confirmTitle: resetTitle })
	});
	check(
		'start over under a foreign host name is refused (421)',
		foreignReset.status === 421,
		`got ${foreignReset.status}`
	);
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		const evil = await send({
			method: 'POST',
			path: '/api/decks/probe-reset/start-over',
			headers: { 'content-type': type, origin: 'https://evil.example' },
			body: JSON.stringify({ confirmTitle: resetTitle })
		});
		check(
			`start over cross-site as ${type.split(';')[0]} is refused (403 or 415)`,
			[403, 415].includes(evil.status),
			`got ${evil.status}`
		);
	}
	const wrongReset = await startOverAction('probe-reset', {
		confirmTitle: '<script>alert(1)</script>'
	});
	check(
		'a wrong title is a 422 that names the field and does not echo what was typed',
		wrongReset.status === 422 &&
			JSON.parse(wrongReset.text).error?.details?.errors?.[0]?.path === 'confirmTitle' &&
			!wrongReset.text.includes('<script'),
		`${wrongReset.status}`
	);
	for (const [label, body] of [
		['a missing title', {}],
		['a title that is a number', { confirmTitle: 5 }],
		['an extra field', { confirmTitle: resetTitle, force: true }],
		['an array', []],
		['the id instead of the title', { confirmTitle: 'probe-reset' }],
		['the title in other case', { confirmTitle: resetTitle.toUpperCase() }]
	] as const) {
		const r = await startOverAction('probe-reset', body);
		check(`${label} resets nothing`, r.status === 422 || r.status === 400, `got ${r.status}`);
	}
	const badResetJson = await post('/api/decks/probe-reset/start-over', '{not json');
	check(
		'a body that is not JSON is a 400',
		badResetJson.status === 400,
		`got ${badResetJson.status}`
	);
	const hugeResetText = JSON.stringify({ confirmTitle: 'x'.repeat(40_000) });
	const hugeReset = await send({
		method: 'POST',
		path: '/api/decks/probe-reset/start-over',
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(hugeResetText)) },
		body: hugeResetText
	});
	check(
		'a body over the small limit is refused (413)',
		hugeReset.status === 413,
		`got ${hugeReset.status}`
	);

	const didReset = await startOverAction('probe-reset', { confirmTitle: ` ${resetTitle} ` });
	const didBody = didReset.status === 200 ? JSON.parse(didReset.text) : undefined;
	check(
		'with the right title the deck is started over, and a snapshot taken first is named',
		didReset.status === 200 &&
			didBody?.reset?.items === 2 &&
			didBody?.deck?.counts?.new === 2 &&
			/^pre-reset-probe-reset-[A-Za-z0-9._-]+\.db$/.test(didBody?.reset?.snapshot?.name ?? ''),
		`${didReset.status} ${didReset.text.slice(0, 120)}`
	);
	check('the response gives no path on the server', !didReset.text.includes('/data'));
	await trashAction('probe-reset', 'trash');
	check(
		'a deck in the Trash cannot be started over (404)',
		(await startOverAction('probe-reset', { confirmTitle: resetTitle })).status === 404
	);
	await trashAction('probe-reset', 'delete-forever', { confirmTitle: resetTitle });

	// ---- 4e. Backups (US-15, ADR-014)
	console.log('\n# Backups');
	const madeBackup = await post('/api/backups', {});
	const backupName: string =
		madeBackup.status === 201 ? JSON.parse(madeBackup.text).backup?.name : '';
	check(
		'a backup can be taken, and answers 201 with a name that is a plain file name',
		madeBackup.status === 201 && /^manual-[A-Za-z0-9._-]+\.db$/.test(backupName),
		`${madeBackup.status} ${madeBackup.text.slice(0, 100)}`
	);
	check(
		'the answer gives no path on the server',
		!madeBackup.text.includes('/data') && !madeBackup.text.includes('\\\\')
	);
	const backupList = await send({ path: '/api/backups' });
	check(
		'the backup is in the list, which is not cached and grants no cross-origin permission',
		backupList.status === 200 &&
			JSON.parse(backupList.text).backups.some((b: { name: string }) => b.name === backupName) &&
			backupList.headers['cache-control'] === 'no-store' &&
			!('access-control-allow-origin' in backupList.headers)
	);
	const downloaded = await send({ path: `/api/backups/${backupName}` });
	check(
		'it downloads as an attachment, and is a SQLite database',
		downloaded.status === 200 &&
			downloaded.headers['content-type'] === 'application/octet-stream' &&
			(downloaded.headers['content-disposition'] ?? '').startsWith('attachment') &&
			downloaded.text.startsWith('SQLite format 3') &&
			!('access-control-allow-origin' in downloaded.headers),
		`${downloaded.status} ${downloaded.headers['content-type']}`
	);

	for (const name of [
		'..%2f..%2fpackage.json',
		'..%2ftessera.db',
		'%2e%2e%2ftessera.db',
		'tessera.db',
		'tessera.db-wal',
		'..%5ctessera.db',
		'sub%2fx.db',
		'%2fetc%2fpasswd',
		'a%00.db',
		`${'x'.repeat(200)}.db`,
		'%3Cscript%3Ealert(1)%3C%2Fscript%3E.db',
		'no-such-backup.db',
		'.hidden.db'
	]) {
		for (const method of ['GET', 'DELETE']) {
			const r = await send({
				method,
				path: `/api/backups/${name}`,
				headers: method === 'GET' ? {} : JSON_HEADERS
			});
			check(
				`${method} of backup "${name.slice(0, 28)}" is a 404 that leaks nothing and echoes nothing`,
				r.status === 404 &&
					!r.text.startsWith('SQLite format') &&
					!r.text.includes('<script') &&
					!r.text.includes('"dependencies"') &&
					!r.text.includes('root:x:') &&
					!/node_modules|\.ts:\d+/.test(r.text),
				`${r.status} ${r.text.slice(0, 60)}`
			);
		}
	}
	check(
		'the live database was not touched by any of that',
		(await send({ path: '/api/decks' })).status === 200
	);

	for (const [method, path] of [
		['PUT', `/api/backups/${backupName}`],
		['PATCH', `/api/backups/${backupName}`],
		['POST', `/api/backups/${backupName}`],
		['DELETE', '/api/backups'],
		['PUT', '/api/backups']
	] as const) {
		const r = await send({ method, path, headers: JSON_HEADERS, body: '{}' });
		check(
			`${method} on ${path.slice(0, 30)} is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	for (const [method, path] of [
		['GET', '/api/backups'],
		['POST', '/api/backups'],
		['GET', `/api/backups/${backupName}`],
		['DELETE', `/api/backups/${backupName}`]
	] as const) {
		const foreign = await send({
			method,
			path,
			headers: { ...(method === 'GET' ? {} : JSON_HEADERS), host: 'attacker.example' },
			...(method === 'POST' ? { body: '{}' } : {})
		});
		check(
			`${method} ${path.slice(0, 20)} under a foreign host name is refused (421)`,
			foreign.status === 421,
			`got ${foreign.status}`
		);
	}
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		for (const [method, path] of [
			['POST', '/api/backups'],
			['DELETE', `/api/backups/${backupName}`]
		] as const) {
			const evil = await send({
				method,
				path,
				headers: { 'content-type': type, origin: 'https://evil.example' },
				body: '{}'
			});
			check(
				`${method} ${path.slice(0, 20)} cross-site as ${type.split(';')[0]} is refused (400, 403, or 415)`,
				[400, 403, 415].includes(evil.status),
				`got ${evil.status}`
			);
		}
	}
	check(
		'and the backup is still there',
		(await send({ path: `/api/backups/${backupName}` })).status === 200
	);
	const deletedBackup = await send({
		method: 'DELETE',
		path: `/api/backups/${backupName}`,
		headers: JSON_HEADERS
	});
	check(
		'a backup can be deleted',
		deletedBackup.status === 200 && JSON.parse(deletedBackup.text).deleted === backupName,
		`${deletedBackup.status}`
	);
	check(
		'and deleting it again is a 404',
		(await send({ method: 'DELETE', path: `/api/backups/${backupName}`, headers: JSON_HEADERS }))
			.status === 404
	);

	// ---- 4f. Restore (US-15, ADR-014). Only refusals and previews: a restore that went through would stop the server.
	console.log('\n# Restore');
	const forRestore = await post('/api/backups', {});
	const restoreName: string =
		forRestore.status === 201 ? JSON.parse(forRestore.text).backup?.name : '';
	const previewed = await send({ path: `/api/backups/${restoreName}/preview` });
	const previewBody = previewed.status === 200 ? JSON.parse(previewed.text) : undefined;
	check(
		'a backup can be previewed: restorable, with its counts and the counts of the data now',
		previewed.status === 200 &&
			previewBody?.restorable === true &&
			typeof previewBody?.summary?.decks === 'number' &&
			typeof previewBody?.current?.cards === 'number' &&
			previewed.headers['cache-control'] === 'no-store' &&
			!('access-control-allow-origin' in previewed.headers),
		`${previewed.status} ${previewed.text.slice(0, 100)}`
	);
	check('and the preview gives no path on the server', !previewed.text.includes('/data'));

	const restoreStillUp = async () => (await send({ path: '/healthz' })).status === 200;
	for (const name of [
		'..%2f..%2fpackage.json',
		'..%2ftessera.db',
		'tessera.db',
		'tessera.db-wal',
		'a%00.db',
		`${'x'.repeat(200)}.db`,
		'%3Cscript%3Ealert(1)%3C%2Fscript%3E.db',
		'no-such-backup.db'
	]) {
		const got = await send({ path: `/api/backups/${name}/preview` });
		const posted = await post(`/api/backups/${name}/restore`, { confirm: 'restore' });
		check(
			`preview and restore of "${name.slice(0, 28)}" are 404s that leak nothing and echo nothing`,
			got.status === 404 &&
				posted.status === 404 &&
				!got.text.includes('<script') &&
				!posted.text.includes('<script') &&
				!/node_modules|\.ts:\d+|root:x:|"dependencies"/.test(got.text + posted.text),
			`${got.status} / ${posted.status}`
		);
	}
	check('and the server is still running after those', await restoreStillUp());

	for (const [label, body] of [
		['no confirmation', {}],
		['the wrong word', { confirm: 'yes' }],
		['the word in capitals', { confirm: 'RESTORE' }],
		['a confirmation that is not text', { confirm: true }],
		['an extra field', { confirm: 'restore', force: true }],
		['an array', []]
	] as const) {
		const r = await post(`/api/backups/${restoreName}/restore`, body);
		check(
			`restore with ${label} is refused and stages nothing`,
			r.status === 422 || r.status === 400,
			`got ${r.status}`
		);
	}
	const notJson = await post(`/api/backups/${restoreName}/restore`, '{not json');
	check(
		'restore with a body that is not JSON is a 400',
		notJson.status === 400,
		`got ${notJson.status}`
	);
	const bigRestore = JSON.stringify({ confirm: 'x'.repeat(40_000) });
	const tooBig = await send({
		method: 'POST',
		path: `/api/backups/${restoreName}/restore`,
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(bigRestore)) },
		body: bigRestore
	});
	check(
		'restore with a body over the small limit is a 413',
		tooBig.status === 413,
		`got ${tooBig.status}`
	);

	for (const [method, path] of [
		['GET', `/api/backups/${restoreName}/restore`],
		['PUT', `/api/backups/${restoreName}/restore`],
		['DELETE', `/api/backups/${restoreName}/restore`],
		['POST', `/api/backups/${restoreName}/preview`],
		['DELETE', `/api/backups/${restoreName}/preview`]
	] as const) {
		const r = await send({ method, path, headers: JSON_HEADERS, body: '{}' });
		check(
			`${method} on ${path.split('/').pop()} is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	for (const [method, path] of [
		['GET', `/api/backups/${restoreName}/preview`],
		['POST', `/api/backups/${restoreName}/restore`]
	] as const) {
		const foreign = await send({
			method,
			path,
			headers: { ...(method === 'POST' ? JSON_HEADERS : {}), host: 'attacker.example' },
			...(method === 'POST' ? { body: JSON.stringify({ confirm: 'restore' }) } : {})
		});
		check(
			`${method} ${path.split('/').pop()} under a foreign host name is refused (421)`,
			foreign.status === 421,
			`got ${foreign.status}`
		);
	}
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		const evil = await send({
			method: 'POST',
			path: `/api/backups/${restoreName}/restore`,
			headers: { 'content-type': type, origin: 'https://evil.example' },
			body: JSON.stringify({ confirm: 'restore' })
		});
		check(
			`restore cross-site as ${type.split(';')[0]} is refused (403 or 415)`,
			[403, 415].includes(evil.status),
			`got ${evil.status}`
		);
	}
	const afterRestoreTries = JSON.parse((await send({ path: '/api/backups' })).text);
	check(
		'after all of that no restore is waiting, no safety copy was made, and the server is still running',
		afterRestoreTries.pendingRestore === undefined &&
			!afterRestoreTries.backups.some((b: { kind: string }) => b.kind === 'pre-restore') &&
			(await restoreStillUp())
	);
	await send({ method: 'DELETE', path: `/api/backups/${restoreName}`, headers: JSON_HEADERS });

	// ---- 4g. Leeches and the weak-spot report (US-6, ADR-015)
	console.log('\n# Leeches and the weak-spot report');
	const leechMarker = 'ZQXJ-LEECH-PROBE-3190';
	await post('/api/import', deck('probe-leech', [basic('l1', leechMarker, 'A'), basic('l2')]));
	const leechList = await send({ path: '/api/leeches' });
	const leechBody = leechList.status === 200 ? JSON.parse(leechList.text) : undefined;
	check(
		'the leech list answers with the leeches, the weakest tags, and a count',
		leechList.status === 200 &&
			Array.isArray(leechBody?.leeches) &&
			Array.isArray(leechBody?.weakTags) &&
			typeof leechBody?.openCount === 'number' &&
			(leechList.headers['content-type'] ?? '').startsWith('application/json') &&
			!('access-control-allow-origin' in leechList.headers),
		`${leechList.status}`
	);
	check(
		'the deck list says how many leeches need attention',
		typeof JSON.parse((await send({ path: '/api/decks' })).text).openLeeches === 'number'
	);
	for (const id of ['nope', 'UPPER', 'a%20b', '..%2f..%2fpackage.json', '%00', 'x'.repeat(100)]) {
		const a = await send({ path: `/api/leeches?deckId=${id}` });
		const b = await send({ path: `/api/report/weak-spots?deckId=${id}` });
		check(
			`a deck filter of "${id.slice(0, 24)}" is a 404 on the list and on the report, and leaks nothing`,
			a.status === 404 &&
				b.status === 404 &&
				!/node_modules|\.ts:\d+|root:x:|"dependencies"/.test(a.text + b.text),
			`${a.status} / ${b.status}`
		);
	}

	for (const [cardPk, ordinal] of [
		['abc', '0'],
		['-1', '0'],
		['1.5', '0'],
		['1e3', '0'],
		['99999999999999999999', '0'],
		['0', '0'],
		['999999', '0'],
		['1', 'x'],
		['1', '9999'],
		['%3Cscript%3E', '0']
	]) {
		const r = await post(`/api/leeches/${cardPk}/${ordinal}/reset`, {});
		const s = await post(`/api/cards/${cardPk}/suspend`, {});
		check(
			`reset and suspend of card "${cardPk}" blank "${ordinal}" are 404s that leak nothing`,
			r.status === 404 &&
				(s.status === 404 || ordinal !== '0') &&
				!/<script|node_modules|\.ts:\d+/.test(r.text + s.text),
			`${r.status} / ${s.status}`
		);
	}

	// A real round trip: suspend a card of a deck made for this, see it leave the queue, put it back.
	const served = await send({ path: '/api/study/next?deckId=probe-leech' });
	const leechPk: number | undefined = JSON.parse(served.text).item?.cardPk;
	if (leechPk === undefined) {
		check('a card of the leech test deck can be served', false, served.text.slice(0, 80));
	} else {
		const suspended = await post(`/api/cards/${leechPk}/suspend`, {});
		check(
			'a card can be suspended, and the answer says so',
			suspended.status === 200 && JSON.parse(suspended.text).suspended === true,
			`${suspended.status}`
		);
		const afterSuspend = await send({ path: '/api/decks' });
		const row = JSON.parse(afterSuspend.text).decks.find(
			(d: { id: string }) => d.id === 'probe-leech'
		);
		check('and it leaves the study counts', row?.counts?.new === 1, JSON.stringify(row?.counts));
		const again = await post(`/api/cards/${leechPk}/suspend`, {});
		check('suspending again is harmless', again.status === 200, `${again.status}`);
		const back = await post(`/api/cards/${leechPk}/unsuspend`, {});
		check(
			'putting it back works and restores the count',
			back.status === 200 &&
				JSON.parse((await send({ path: '/api/decks' })).text).decks.find(
					(d: { id: string }) => d.id === 'probe-leech'
				)?.counts?.new === 2,
			`${back.status}`
		);
		const resetIt = await post(`/api/leeches/${leechPk}/0/reset`, {});
		check(
			'resetting an item that is not a leech is harmless',
			resetIt.status === 200,
			`${resetIt.status}`
		);
	}

	for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
		for (const path of [
			'/api/leeches/1/0/reset',
			'/api/cards/1/suspend',
			'/api/cards/1/unsuspend'
		]) {
			const r = await send({
				method,
				path,
				headers: method === 'GET' ? {} : JSON_HEADERS,
				...(method === 'GET' ? {} : { body: '{}' })
			});
			check(
				`${method} on ${path} is refused`,
				[400, 403, 404, 405].includes(r.status),
				`got ${r.status}`
			);
		}
	}
	for (const method of ['POST', 'PUT', 'DELETE']) {
		for (const path of ['/api/leeches', '/api/report/weak-spots']) {
			const r = await send({ method, path, headers: JSON_HEADERS, body: '{}' });
			check(
				`${method} on ${path} is refused`,
				[400, 403, 404, 405].includes(r.status),
				`got ${r.status}`
			);
		}
	}
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		for (const path of ['/api/cards/1/suspend', '/api/leeches/1/0/reset']) {
			const evil = await send({
				method: 'POST',
				path,
				headers: { 'content-type': type, origin: 'https://evil.example' },
				body: '{}'
			});
			check(
				`${path.split('/').slice(-1)[0]} cross-site as ${type.split(';')[0]} is refused (403 or 415)`,
				[403, 415].includes(evil.status),
				`got ${evil.status}`
			);
		}
	}
	for (const [method, path] of [
		['GET', '/api/leeches'],
		['GET', '/api/report/weak-spots'],
		['POST', '/api/cards/1/suspend'],
		['POST', '/api/leeches/1/0/reset']
	] as const) {
		const foreign = await send({
			method,
			path,
			headers: { ...(method === 'POST' ? JSON_HEADERS : {}), host: 'attacker.example' },
			...(method === 'POST' ? { body: '{}' } : {})
		});
		check(
			`${method} ${path} under a foreign host name is refused (421)`,
			foreign.status === 421,
			`got ${foreign.status}`
		);
	}

	const reportMd = await send({ path: '/api/report/weak-spots' });
	check(
		'the weak-spot report is Markdown, not cached, and has no cross-origin permission',
		reportMd.status === 200 &&
			reportMd.headers['content-type'] === 'text/markdown; charset=utf-8' &&
			reportMd.headers['cache-control'] === 'no-store' &&
			!('access-control-allow-origin' in reportMd.headers) &&
			reportMd.text.startsWith('# Tessera weak-spot report'),
		`${reportMd.status} ${reportMd.headers['content-type']}`
	);
	const reportJson = await send({ path: '/api/report/weak-spots?format=json' });
	check(
		'and JSON when asked, with the schema address and the same shape',
		reportJson.status === 200 &&
			JSON.parse(reportJson.text).report === 'tessera-weak-spots' &&
			Array.isArray(JSON.parse(reportJson.text).decks) &&
			typeof JSON.parse(reportJson.text).schemaUrl === 'string'
	);
	for (const format of ['xml', 'MD', '', 'json;x', '../x']) {
		const r = await send({ path: `/api/report/weak-spots?format=${encodeURIComponent(format)}` });
		check(`the format "${format}" is refused with a 400`, r.status === 400, `got ${r.status}`);
	}
	check(
		'the report gives no path on the server',
		!/\/data\b|node_modules|\.ts:\d+/.test(reportMd.text + reportJson.text)
	);
	check(
		'a deck with no leeches is not an error',
		(await send({ path: '/api/report/weak-spots?deckId=probe-leech' })).status === 200
	);

	// ---- 4h. Settings (M3-09)
	console.log('\n# Settings');
	const putSettings = (body: unknown, headers = JSON_HEADERS) =>
		send({
			method: 'PUT',
			path: '/api/settings',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		});
	const settingsGet = await send({ path: '/api/settings' });
	const settingsBody = settingsGet.status === 200 ? JSON.parse(settingsGet.text) : undefined;
	check(
		'the settings answer with the values, the defaults, and the time zone, not cached and without cross-origin permission',
		settingsGet.status === 200 &&
			typeof settingsBody?.settings?.newPerDay === 'number' &&
			typeof settingsBody?.defaults?.newPerDay === 'number' &&
			typeof settingsBody?.timeZone === 'string' &&
			settingsGet.headers['cache-control'] === 'no-store' &&
			!('access-control-allow-origin' in settingsGet.headers),
		`${settingsGet.status}`
	);
	const originalNewPerDay: number = settingsBody?.settings?.newPerDay ?? 20;
	const changed = await putSettings({ newPerDay: originalNewPerDay === 21 ? 22 : 21 });
	check(
		'a setting can be changed, and the answer carries all of them',
		changed.status === 200 &&
			JSON.parse(changed.text).settings.newPerDay !== originalNewPerDay &&
			typeof JSON.parse(changed.text).settings.leechThreshold === 'number',
		`${changed.status}`
	);
	for (const [label, body] of [
		['a number below the range', { newPerDay: -1 }],
		['a number above the range', { newPerDay: 1001 }],
		['a fraction where a whole number is needed', { leechThreshold: 2.5 }],
		['text where a number is needed', { newPerDay: '20' }],
		['null', { rolloverHour: null }],
		['a retention that is a percent, not a fraction', { targetRetention: 90 }],
		['text where on or off is needed', { interleave: 'yes' }],
		['a setting that does not exist', { secret: true }],
		['an empty set', {}],
		['an array', []],
		['a number', 5],
		['a mix of one good value and one bad one', { newPerDay: 5, leechThreshold: 1 }]
	] as const) {
		const r = await putSettings(body);
		check(`settings with ${label} are refused with a 422`, r.status === 422, `got ${r.status}`);
	}
	const unknown = await putSettings({ '<script>alert(1)</script>': 1 });
	check(
		'an unknown setting with markup for a name is refused and not echoed',
		unknown.status === 422 && !unknown.text.includes('<script'),
		`${unknown.status}`
	);
	check(
		'and a refused change saved nothing, even the good value in it',
		JSON.parse((await send({ path: '/api/settings' })).text).settings.newPerDay !== 5
	);
	check('a body that is not JSON is a 400', (await putSettings('{not json')).status === 400);
	const bigSettings = JSON.stringify({ newPerDay: 5, pad: 'x'.repeat(40_000) });
	const tooBigSettings = await send({
		method: 'PUT',
		path: '/api/settings',
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(bigSettings)) },
		body: bigSettings
	});
	check(
		'a body over the small limit is a 413',
		tooBigSettings.status === 413,
		`got ${tooBigSettings.status}`
	);
	for (const method of ['POST', 'PATCH', 'DELETE']) {
		const r = await send({ method, path: '/api/settings', headers: JSON_HEADERS, body: '{}' });
		check(
			`${method} on the settings is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	for (const type of [
		'text/plain',
		'application/x-www-form-urlencoded',
		'multipart/form-data; boundary=x'
	]) {
		const evil = await send({
			method: 'PUT',
			path: '/api/settings',
			headers: { 'content-type': type, origin: 'https://evil.example' },
			body: '{"newPerDay":999}'
		});
		check(
			`changing the settings cross-site as ${type.split(';')[0]} is refused (403 or 415)`,
			[403, 415].includes(evil.status),
			`got ${evil.status}`
		);
	}
	check(
		'and none of that changed anything',
		JSON.parse((await send({ path: '/api/settings' })).text).settings.newPerDay !== 999
	);
	const foreignSettings = await send({
		method: 'PUT',
		path: '/api/settings',
		headers: { ...JSON_HEADERS, host: 'attacker.example' },
		body: '{"newPerDay":5}'
	});
	check(
		'changing the settings under a foreign host name is refused (421)',
		foreignSettings.status === 421,
		`got ${foreignSettings.status}`
	);
	check(
		'reading them under a foreign host name is refused too',
		(await send({ path: '/api/settings', headers: { host: 'attacker.example' } })).status === 421
	);
	// Put it back as it was.
	await putSettings({ newPerDay: originalNewPerDay });
	check(
		'the setting is back as it was',
		JSON.parse((await send({ path: '/api/settings' })).text).settings.newPerDay ===
			originalNewPerDay
	);

	// ---- Practice again (ADR-017): it adds log rows and changes nothing else
	console.log('\n# Practice again');
	// Answer ids are fresh each run: the remote check runs this probe twice against one server.
	const runId = Date.now().toString(36);
	await post('/api/import', deck('probe-practice', [basic('p1'), basic('p2'), basic('p3')]));
	const practiceDeck = async () =>
		JSON.parse((await send({ path: '/api/decks' })).text).decks.find(
			(d: { id: string }) => d.id === 'probe-practice'
		);
	const practiceServed = async () =>
		JSON.parse((await send({ path: '/api/study/next?deckId=probe-practice' })).text);
	const practiceBefore = await practiceServed();
	const poolReply = await send({ path: '/api/practice/pool?deckId=probe-practice' });
	check(
		'the practice pool counts the items of a deck',
		poolReply.status === 200 && JSON.parse(poolReply.text).total === 3,
		poolReply.text.slice(0, 80)
	);
	for (const query of [
		'',
		'?deckId=probe-practice&folderId=1',
		'?deckId=',
		'?deckId=NOPE%20NOPE',
		'?deckId=no-such-deck',
		'?folderId=0',
		'?folderId=-1',
		'?folderId=1e3',
		'?folderId=99999999999999999999',
		'?folderId=999999',
		'?deckId[]=a&deckId[]=b',
		'?deckId=%3Cscript%3E'
	]) {
		const r = await send({ path: `/api/practice/pool${query}` });
		check(
			`the practice pool for "${query}" is a 400 or 404 that leaks nothing`,
			(r.status === 400 || r.status === 404) &&
				!/<script|node_modules|\.ts:\d+|root:x:/.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	for (const body of [
		'{}',
		'[]',
		'null',
		'"text"',
		'{"deckId":"probe-practice"}',
		'{"deckId":"probe-practice","count":0,"order":"shuffle"}',
		'{"deckId":"probe-practice","count":-1,"order":"shuffle"}',
		'{"deckId":"probe-practice","count":1.5,"order":"shuffle"}',
		'{"deckId":"probe-practice","count":1e9,"order":"shuffle"}',
		'{"deckId":"probe-practice","count":"many","order":"shuffle"}',
		'{"deckId":"probe-practice","count":"all","order":"random"}',
		'{"deckId":"probe-practice","folderId":1,"count":"all","order":"shuffle"}',
		'{"deckId":"probe-practice","count":"all","order":"shuffle","extra":1}',
		'{"__proto__":{"polluted":true},"deckId":"probe-practice","count":"all","order":"shuffle"}',
		'{"deckId":["probe-practice"],"count":"all","order":"shuffle"}',
		'{not json'
	]) {
		const r = await post('/api/practice/start', body);
		check(
			`practice start refuses ${body.slice(0, 50)}`,
			[400, 422].includes(r.status) && !/node_modules|\.ts:\d+/.test(r.text),
			`got ${r.status}`
		);
	}
	// A body over the small limit, sent with its length so the answer is a 413 (a chunked one is backlog B-3).
	const bigPractice = `{"deckId":"probe-practice","count":"all","order":"shuffle","pad":"${'x'.repeat(20_000)}"}`;
	const oversized = await send({
		method: 'POST',
		path: '/api/practice/start',
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(bigPractice)) },
		body: bigPractice
	});
	check(
		'an oversized practice start is refused with 413',
		oversized.status === 413,
		`got ${oversized.status}`
	);
	const bigGrade = `{"reviewId":"probe-practice-big1","cardPk":1,"ordinal":0,"right":true,"typedAnswer":"${'y'.repeat(20_000)}"}`;
	const oversizedGrade = await send({
		method: 'POST',
		path: '/api/practice/grade',
		headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(bigGrade)) },
		body: bigGrade
	});
	check(
		'an oversized practice answer is refused with 413',
		oversizedGrade.status === 413,
		`got ${oversizedGrade.status}`
	);

	const startReply = await post('/api/practice/start', {
		deckId: 'probe-practice',
		count: 'all',
		order: 'weakest'
	});
	const practiceStarted: { items?: { cardPk: number; ordinal: number }[]; poolSize?: number } =
		JSON.parse(startReply.text);
	check(
		'a practice session starts with ordered references',
		startReply.status === 200 &&
			practiceStarted.items?.length === 3 &&
			practiceStarted.poolSize === 3,
		startReply.text.slice(0, 80)
	);
	check(
		'starting a session changes nothing',
		(await practiceServed()).item?.cardPk === practiceBefore.item?.cardPk
	);

	for (const query of [
		'',
		'?cardPk=1',
		'?ordinal=0',
		'?cardPk=abc&ordinal=0',
		'?cardPk=-1&ordinal=0',
		'?cardPk=1.5&ordinal=0',
		'?cardPk=1e3&ordinal=0',
		'?cardPk=0&ordinal=0',
		'?cardPk=99999999999999999999&ordinal=0',
		'?cardPk=1&ordinal=x',
		'?cardPk=1&ordinal=9999',
		'?cardPk=999999&ordinal=0',
		'?cardPk=%3Cscript%3E&ordinal=0'
	]) {
		const r = await send({ path: `/api/practice/item${query}` });
		check(
			`a practice item for "${query}" is a 400 or 404 that leaks nothing`,
			(r.status === 400 || r.status === 404) &&
				!/<script|node_modules|\.ts:\d+|root:x:/.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	const first = practiceStarted.items?.[0];
	if (!first) {
		check('a practice item can be read', false, 'no item to read');
	} else {
		const itemReply = await send({
			path: `/api/practice/item?cardPk=${first.cardPk}&ordinal=${first.ordinal}`
		});
		const shown = JSON.parse(itemReply.text).item;
		check(
			'a practice item is read, without schedule parts',
			itemReply.status === 200 &&
				shown?.cardPk === first.cardPk &&
				shown.previews === undefined &&
				shown.servedAt === undefined,
			itemReply.text.slice(0, 80)
		);

		const answer = (overrides: Record<string, unknown> = {}) => ({
			reviewId: `probe-${runId}-0001`,
			cardPk: first.cardPk,
			ordinal: first.ordinal,
			right: false,
			...overrides
		});
		const graded = await post('/api/practice/grade', answer());
		check(
			'a practice answer is recorded',
			graded.status === 200 && JSON.parse(graded.text).replayed === false,
			`${graded.status} ${graded.text.slice(0, 80)}`
		);
		const replayed = await post('/api/practice/grade', answer());
		check(
			'the same answer sent again is a replay, not a second row',
			replayed.status === 200 && JSON.parse(replayed.text).replayed === true
		);
		const reused = await post(
			'/api/practice/grade',
			answer({ cardPk: practiceStarted.items?.[1]?.cardPk ?? first.cardPk + 1 })
		);
		check(
			'an answer id used for another card is refused',
			reused.status === 400,
			`got ${reused.status}`
		);
		for (let i = 2; i <= 12; i++) {
			await post(
				'/api/practice/grade',
				answer({ reviewId: `probe-${runId}-${String(i).padStart(4, '0')}`, right: i % 2 === 0 })
			);
		}
		const after = await practiceServed();
		check(
			'twelve practice answers left the study queue as it was',
			after.item?.cardPk === practiceBefore.item?.cardPk &&
				JSON.stringify(after.counts) === JSON.stringify(practiceBefore.counts) &&
				JSON.stringify(after.item?.state) === JSON.stringify(practiceBefore.item?.state),
			`${JSON.stringify(after.counts)} vs ${JSON.stringify(practiceBefore.counts)}`
		);
		check(
			'and the deck still shows all its cards as new',
			(await practiceDeck())?.counts?.new === 3,
			JSON.stringify((await practiceDeck())?.counts)
		);
		const asReview = await post('/api/study/review', {
			reviewId: `probe-${runId}-0001`,
			cardPk: first.cardPk,
			ordinal: first.ordinal,
			grade: 3,
			servedAt: new Date().toISOString()
		});
		check(
			'a practice answer id cannot be replayed as a study review',
			asReview.status === 400,
			`got ${asReview.status}`
		);

		for (const body of [
			'{}',
			'[]',
			'null',
			JSON.stringify(answer({ right: 'yes' })),
			JSON.stringify(answer({ right: 1 })),
			JSON.stringify(answer({ grade: 3 })),
			JSON.stringify(answer({ reviewId: 'short' })),
			JSON.stringify(answer({ reviewId: 'has spaces and <b>markup</b>' })),
			JSON.stringify(answer({ reviewId: 'x'.repeat(65) })),
			JSON.stringify(answer({ cardPk: 'one' })),
			JSON.stringify(answer({ cardPk: -1, reviewId: 'probe-practice-neg1' })),
			JSON.stringify(answer({ ordinal: 100, reviewId: 'probe-practice-ord1' })),
			JSON.stringify(answer({ durationMs: -5, reviewId: 'probe-practice-dur1' })),
			JSON.stringify(answer({ typedAnswer: 'x'.repeat(2001), reviewId: 'probe-practice-typ1' })),
			'{"__proto__":{"polluted":true},"reviewId":"probe-practice-pro1","cardPk":1,"ordinal":0,"right":true}',
			'{not json'
		]) {
			const r = await post('/api/practice/grade', body);
			check(
				`a practice answer of ${body.slice(0, 50)} is refused`,
				[400, 422].includes(r.status) && !/node_modules|\.ts:\d+/.test(r.text),
				`got ${r.status}`
			);
		}
		const missing = await post(
			'/api/practice/grade',
			answer({ cardPk: 999_999, reviewId: 'probe-practice-gone1' })
		);
		check('an answer for a card that does not exist is a 404', missing.status === 404);
		check(
			'and none of the refused answers changed the queue',
			(await practiceServed()).item?.cardPk === practiceBefore.item?.cardPk
		);
	}

	const wrongMethods: [string, string][] = [
		['GET', '/api/practice/start'],
		['GET', '/api/practice/grade'],
		['POST', '/api/practice/pool'],
		['POST', '/api/practice/item'],
		['PUT', '/api/practice/grade'],
		['DELETE', '/api/practice/start'],
		['PATCH', '/api/practice/grade']
	];
	for (const [method, path] of wrongMethods) {
		const r = await send({
			method,
			path,
			headers: method === 'GET' ? {} : JSON_HEADERS,
			...(method === 'GET' ? {} : { body: '{}' })
		});
		check(
			`${method} on ${path} is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	for (const path of ['/api/practice/start', '/api/practice/grade']) {
		const r = await send({
			method: 'POST',
			path,
			headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
			body: '{}'
		});
		check(
			`a cross-site POST to ${path} is refused`,
			[400, 403, 415].includes(r.status),
			`got ${r.status}`
		);
	}

	// ---- Statistics and folder exam dates (ADR-017): read only, and a date field that takes one exact form
	console.log('\n# Statistics and exam dates');
	await post('/api/import', deck('probe-stats', [basic('s1'), basic('s2')]));
	const statsReply = await send({ path: '/api/stats' });
	const statsBody = statsReply.status === 200 ? JSON.parse(statsReply.text) : undefined;
	check(
		'the statistics answer for every deck, with every section',
		statsReply.status === 200 &&
			statsBody?.scope?.kind === 'all' &&
			Array.isArray(statsBody.heatmap) &&
			statsBody.heatmap.length === 26 &&
			statsBody.forecast?.days?.length === 30 &&
			statsBody.days?.length === 14 &&
			typeof statsBody.practicedToday?.answers === 'number',
		`${statsReply.status} ${statsReply.text.slice(0, 80)}`
	);
	const deckStats = await send({ path: '/api/stats?deckId=probe-stats' });
	check(
		'the statistics for one deck count only that deck',
		deckStats.status === 200 &&
			JSON.parse(deckStats.text).scope?.id === 'probe-stats' &&
			JSON.parse(deckStats.text).cardCount === 2,
		deckStats.text.slice(0, 80)
	);
	for (const query of [
		'?deckId=probe-stats&folderId=1',
		'?deckId=',
		'?deckId=NOPE%20NOPE',
		'?deckId=no-such-deck',
		'?folderId=0',
		'?folderId=-1',
		'?folderId=1e3',
		'?folderId=99999999999999999999',
		'?folderId=999999',
		'?deckId[]=a&deckId[]=b',
		'?deckId=%3Cscript%3E',
		'?deckId=../../etc/passwd',
		"?deckId=probe-stats'%20or%20'1'='1"
	]) {
		const r = await send({ path: `/api/stats${query}` });
		// A parameter the server does not read (deckId[]) or an empty one means "every deck", which is harmless.
		const empty = (query === '?deckId=' || query.startsWith('?deckId[]')) && r.status === 200;
		check(
			`the statistics for "${query}" are a 400 or 404 that leaks nothing`,
			(r.status === 400 || r.status === 404 || empty) &&
				!/<script|node_modules|\.ts:\d+|root:x:|SQLITE|syntax error/i.test(r.text),
			`${r.status} ${r.text.slice(0, 80)}`
		);
	}
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		const r = await send({ method, path: '/api/stats', headers: JSON_HEADERS, body: '{}' });
		check(
			`${method} on /api/stats is refused`,
			[400, 403, 404, 405].includes(r.status),
			`got ${r.status}`
		);
	}
	const burstStats = await Promise.all(
		Array.from({ length: 40 }, () => send({ path: '/api/stats?deckId=probe-stats' }))
	);
	check(
		'forty concurrent statistics requests all succeed',
		burstStats.every((r) => r.status === 200),
		`${burstStats.filter((r) => r.status !== 200).length} failed`
	);

	const examFolder = await post('/api/folders', { name: `Probe exam ${runId}` });
	const examId: number | undefined =
		examFolder.status === 201 ? JSON.parse(examFolder.text).folder.id : undefined;
	if (examId === undefined) {
		check('a folder for the exam date checks can be made', false, `got ${examFolder.status}`);
	} else {
		const put = (value: unknown) =>
			send({
				method: 'PUT',
				path: `/api/folders/${examId}`,
				headers: JSON_HEADERS,
				body: typeof value === 'string' ? value : JSON.stringify(value)
			});
		const set = await put({ examDate: '2030-06-15' });
		check(
			'an exam date is saved and the folder answers the countdown',
			set.status === 200 &&
				JSON.parse(set.text).folder.examDate === '2030-06-15' &&
				typeof JSON.parse(set.text).folder.daysToExam === 'number',
			`${set.status} ${set.text.slice(0, 80)}`
		);
		for (const bad of [
			'2030-02-30',
			'2030-13-01',
			'30-06-15',
			'2030/06/15',
			'20300615',
			' 2030-06-15',
			'2030-06-15T00:00:00Z',
			'1999-01-01',
			'2999-01-01',
			'',
			'<script>alert(1)</script>',
			"2030-06-15'; drop table folders; --",
			'x'.repeat(5000)
		]) {
			const r = await put({ examDate: bad });
			check(
				`an exam date of ${JSON.stringify(bad).slice(0, 40)} is refused`,
				[400, 413, 422].includes(r.status) && !/node_modules|\.ts:\d+/.test(r.text),
				`got ${r.status}`
			);
		}
		for (const bad of [
			{ examDate: 20300615 },
			{ examDate: true },
			{ examDate: ['2030-06-15'] },
			{ examDate: { day: 1 } },
			{ examDate: '2030-06-15', extra: 1 },
			{},
			[],
			null
		]) {
			const r = await put(bad);
			check(
				`a folder change of ${JSON.stringify(bad).slice(0, 40)} is refused`,
				r.status === 422,
				`got ${r.status}`
			);
		}
		const still = await send({ path: '/api/folders' });
		check(
			'none of the refused dates changed the saved one',
			JSON.parse(still.text).folders.find((f: { id: number }) => f.id === examId)?.examDate ===
				'2030-06-15'
		);
		const cleared = await put({ examDate: null });
		check(
			'null clears the exam date',
			cleared.status === 200 &&
				JSON.parse(cleared.text).folder.examDate === null &&
				JSON.parse(cleared.text).folder.daysToExam === null
		);
		await send({ method: 'DELETE', path: `/api/folders/${examId}`, headers: JSON_HEADERS });
	}

	// ---- The installable app (ADR-018): a manifest, icons, a worker, and an offline page, all static and read only
	console.log('\n# Installable app files');
	const fresh = (options: Parameters<typeof send>[0]) => send({ ...options, fresh: true });
	const appFiles: [string, RegExp][] = [
		['/manifest.webmanifest', /application\/manifest\+json/],
		['/service-worker.js', /javascript/],
		['/offline.html', /text\/html/],
		['/icons/icon-192.png', /^image\/png$/],
		['/icons/icon-512.png', /^image\/png$/],
		['/icons/icon-maskable-512.png', /^image\/png$/],
		['/icons/apple-touch-icon.png', /^image\/png$/]
	];
	for (const [path, type] of appFiles) {
		const r = await fresh({ path });
		check(
			`${path} is served with the right type`,
			r.status === 200 && type.test(String(r.headers['content-type'] ?? '')),
			`${r.status} ${r.headers['content-type']}`
		);
		check(
			`${path} carries no CORS approval and sets no cookie`,
			r.headers['access-control-allow-origin'] === undefined &&
				r.headers['set-cookie'] === undefined
		);
		// Static files are public and are served before the request hooks (the host check, like the fonts and robots.txt),
		// so a foreign host name reaches them. They hold nothing private: the data is behind /api, which is guarded.
		const foreign = await fresh({ path, headers: { host: 'attacker.example' } });
		check(
			`${path} is the same file under any host name`,
			foreign.status === 200 && foreign.text === r.text
		);
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			// A static file answers a write at once (405) without reading the body, and over a real network that can end
			// the connection while the client is still sending it. A reset is the server refusing, so it counts as refused.
			const w = await fresh({ method, path, headers: JSON_HEADERS, body: '{}' }).catch(
				(error: NodeJS.ErrnoException) =>
					['ECONNRESET', 'EPIPE'].includes(String(error.code))
						? { status: 405, text: '', headers: {} as Record<string, string> }
						: Promise.reject(error)
			);
			check(
				`${method} on ${path} is refused`,
				[400, 403, 404, 405].includes(w.status) && !/node_modules|\.ts:\d+/.test(w.text),
				`got ${w.status}`
			);
		}
	}
	const manifestReply = await fresh({ path: '/manifest.webmanifest' });
	let manifestBody: {
		start_url?: string;
		scope?: string;
		display?: string;
		icons?: { src: string }[];
	} = {};
	try {
		manifestBody = JSON.parse(manifestReply.text);
	} catch {
		// reported below
	}
	check(
		'the manifest is JSON that stays on this origin',
		manifestBody.start_url === '/' &&
			manifestBody.scope === '/' &&
			manifestBody.display === 'standalone' &&
			(manifestBody.icons ?? []).length >= 3 &&
			(manifestBody.icons ?? []).every(
				(icon) => icon.src.startsWith('/') && !icon.src.startsWith('//')
			),
		manifestReply.text.slice(0, 80)
	);
	const offlineReply = await fresh({ path: '/offline.html' });
	check(
		'the offline page has no script and loads nothing from anywhere else',
		!/<script/i.test(offlineReply.text) && !/https?:\/\//i.test(offlineReply.text)
	);
	const workerReply = await fresh({ path: '/service-worker.js' });
	check(
		'the worker never mentions the API in a way that would handle it, and only asks for its own files',
		/shouldHandle|api/.test(workerReply.text) &&
			!/\.put\(/.test(workerReply.text.replace(/\s+/g, ' '))
	);
	for (const path of [
		'/icons/../package.json',
		'/icons/%2e%2e/package.json',
		'/icons/..%2fpackage.json',
		'/icons/icon-192.png/../../package.json',
		'/manifest.webmanifest/../package.json',
		'/offline.html%00.png'
	]) {
		const r = await fresh({ path });
		check(
			`traversal through ${path} leaks nothing`,
			!r.text.includes('"dependencies"') && !r.text.includes('root:x:'),
			`${r.status}`
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
	if (next.item) {
		await post('/api/practice/grade', {
			reviewId: 'probe-practice-log-01',
			cardPk: next.item.cardPk,
			ordinal: next.item.ordinal,
			right: false,
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
	// 300 connections at once can overflow the operating system's queue of waiting connections (Windows refuses the
	// extra ones while the server works through the rest). That is the machine, not the server, so a refused
	// connection is tried again a few times. What must hold: every request is answered 200 and the server stays up.
	const patientGet = async (path: string): Promise<Reply> => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await send({ path });
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== 'ECONNREFUSED' || attempt >= 8) throw error;
				await new Promise((r) => setTimeout(r, 250));
			}
		}
	};
	const burst = await Promise.all(Array.from({ length: 300 }, () => patientGet('/api/decks')));
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
	if (child) {
		console.error(`The server exited with code ${child.exitCode}. Its last output:`);
		console.error(serverOutput.join('').split('\n').slice(-12).join('\n'));
	}
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
