import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { closeApp, initApp } from '#lib/server/app.ts';
import {
	apiTokenGuard,
	contentTypeGuard,
	hostGuard,
	requestLogging,
	securityHeaders
} from '#lib/server/http/hooks.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// ADR-009 and ADR-011: with TESSERA_API_TOKEN set, the API needs the token unless the Tessera page itself sent
// the request. This runs the real guards in the real order against a server configured with a token.

const TOKEN = 'k3y-0123456789abcdef0123456789abcdef';
let dir: TempDir;
const logged: string[] = [];

type Next = (event: RequestEvent) => Promise<Response>;
type Hook = (input: { event: RequestEvent; resolve: Next }) => Promise<Response>;

const hooks = [
	requestLogging,
	securityHeaders,
	hostGuard,
	apiTokenGuard,
	contentTypeGuard
] as unknown as Hook[];

function handle({ event, resolve }: { event: RequestEvent; resolve: Next }): Promise<Response> {
	const next = (index: number, current: RequestEvent): Promise<Response> =>
		index === hooks.length
			? resolve(current)
			: hooks[index]!({ event: current, resolve: (e) => next(index + 1, e ?? current) });
	return next(0, event);
}

beforeAll(() => {
	dir = makeTempDir();
	process.env['DATA_DIR'] = dir.path;
	process.env['LOG_LEVEL'] = 'debug';
	process.env['TESSERA_API_TOKEN'] = TOKEN;
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
		logged.push(String(chunk));
		return true;
	});
	initApp();
});

afterAll(() => {
	vi.restoreAllMocks();
	closeApp();
	delete process.env['TESSERA_API_TOKEN'];
	dir.cleanup();
});

const ORIGIN = 'http://localhost';

async function call(
	method: string,
	path: string,
	headers: Record<string, string> = {},
	url = `${ORIGIN}${path}`
) {
	const request = new Request(url, { method, headers });
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		request,
		url: new URL(request.url),
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	const response = await handle({ event, resolve });
	return { response, reached: resolve.mock.calls.length > 0 };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('the token', () => {
	it('is announced at startup without being printed', () => {
		const startup = logged.join('');
		expect(startup).toContain('API token: set');
		expect(startup).not.toContain(TOKEN);
	});

	it('is required for a call with nothing to show where it came from', async () => {
		const { response, reached } = await call('GET', '/api/decks');
		expect(reached).toBe(false);
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe('Bearer realm="tessera"');
		expect(response.headers.get('x-request-id')).toBeTruthy();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = await response.json();
		expect(body.error.code).toBe('unauthorized');
		expect(body.error.message).toContain('Authorization: Bearer');
		expect(JSON.stringify(body)).not.toContain(TOKEN);
	});

	it('is accepted when right, whatever the case of the word Bearer', async () => {
		for (const header of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `BEARER  ${TOKEN} `]) {
			expect((await call('GET', '/api/decks', { authorization: header })).reached, header).toBe(
				true
			);
		}
	});

	it.each([
		['a wrong token', bearer('wrong-wrong-wrong-wrong-wrong')],
		['a token one character short', bearer(TOKEN.slice(0, -1))],
		['a token with a character added', bearer(`${TOKEN}x`)],
		['the right token in the wrong case', bearer(TOKEN.toUpperCase())],
		['an empty token', { authorization: 'Bearer ' }],
		['the token with no scheme', { authorization: TOKEN }],
		['the token under Basic', { authorization: `Basic ${TOKEN}` }],
		['the token in another header', { 'x-api-key': TOKEN }],
		['the token as a query value', {}]
	])('is refused for %s', async (_name, headers) => {
		const path =
			_name === 'the token as a query value' ? `/api/decks?token=${TOKEN}` : '/api/decks';
		const { response, reached } = await call('GET', path, headers);
		expect(reached).toBe(false);
		expect(response.status).toBe(401);
	});

	it('protects every method', async () => {
		for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
			const { response } = await call(method, '/api/import', {
				'content-type': 'application/json'
			});
			expect(response.status, method).toBe(401);
		}
	});

	it('is judged before the content type, so a caller without it learns nothing about the API', async () => {
		const wrongType = { 'content-type': 'text/plain' };
		expect((await call('POST', '/api/import', wrongType)).response.status).toBe(401);
		expect(
			(await call('POST', '/api/import', { ...wrongType, ...bearer(TOKEN) })).response.status
		).toBe(415);
	});
});

describe('paths the token does not cover', () => {
	it.each([
		'/healthz',
		'/api/schema',
		'/',
		'/import',
		'/study/ccna',
		'/_app/immutable/entry/start.js',
		'/favicon.ico'
	])('%s', async (path) => {
		expect((await call('GET', path)).reached, path).toBe(true);
	});
});

describe('paths that must not slip past the guard', () => {
	it.each([
		'/%61pi/decks',
		'/ap%69/decks',
		'/api/%64ecks',
		'/api/study/%6eext',
		'/api/schema/',
		'/api/schema/x',
		'/api/Schema',
		'/api',
		'/api/',
		'/api/%E0%A4%A'
	])('%s needs the token', async (path) => {
		const { response, reached } = await call('GET', path);
		expect(reached, path).toBe(false);
		expect(response.status).toBe(401);
	});

	it('a path that looks like the schema but decodes to it is as open as the schema', async () => {
		expect((await call('GET', '/api/sch%65ma')).reached).toBe(true);
	});
});

describe('requests from the Tessera page itself', () => {
	it('are answered without a token, by Sec-Fetch-Site', async () => {
		const { reached } = await call('GET', '/api/decks', { 'sec-fetch-site': 'same-origin' });
		expect(reached).toBe(true);
	});

	it('are answered without a token, by a matching Origin', async () => {
		const { reached } = await call('POST', '/api/import', {
			origin: ORIGIN,
			'content-type': 'application/json'
		});
		expect(reached).toBe(true);
	});

	it('are answered by a matching Origin even though the server believes it is https', async () => {
		// adapter-node assumes https unless told otherwise, so the URL the server sees says https while the browser, on
		// plain HTTP, wrote an http Origin. Found by running a real browser against a built server.
		const { reached } = await call(
			'POST',
			'/api/import',
			{ origin: 'http://localhost', 'content-type': 'application/json' },
			'https://localhost/api/import'
		);
		expect(reached).toBe(true);
	});

	it('are answered without a token, by the page marker, as on plain HTTP', async () => {
		expect((await call('GET', '/api/decks', { 'x-tessera-client': 'web' })).reached).toBe(true);
	});

	it.each([
		['cross-site', { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' }],
		[
			'cross-site with the right Origin and the marker',
			{ 'sec-fetch-site': 'cross-site', origin: ORIGIN, 'x-tessera-client': 'web' }
		],
		['same-site (another port)', { 'sec-fetch-site': 'same-site', 'x-tessera-client': 'web' }],
		['a typed address', { 'sec-fetch-site': 'none', 'x-tessera-client': 'web' }],
		['another Origin without Sec-Fetch-Site', { origin: 'http://evil.example' }],
		['the same host name on another port', { origin: 'http://localhost:3001' }],
		[
			'another Origin with the marker',
			{ origin: 'http://evil.example', 'x-tessera-client': 'web' }
		],
		['the null Origin of a sandboxed page', { origin: 'null' }],
		['a wrong marker', { 'x-tessera-client': 'yes' }]
	])('are not recognized when they look %s', async (_name, headers) => {
		const { response, reached } = await call('GET', '/api/decks', headers);
		expect(reached).toBe(false);
		expect(response.status).toBe(401);
	});

	it('still need the right host name: a rebound host is refused even with the right signals', async () => {
		const { response, reached } = await call(
			'GET',
			'/api/decks',
			{ 'sec-fetch-site': 'same-origin', ...bearer(TOKEN) },
			'http://rebind.attacker.example/api/decks'
		);
		expect(reached).toBe(false);
		expect(response.status).toBe(421);
	});
});

describe('what is logged', () => {
	it('records a refusal with the request id and path, never the token', async () => {
		logged.length = 0;
		const { response } = await call('GET', '/api/decks', bearer('a-guess-that-is-wrong-wrong'));
		const refusal = logged
			.join('')
			.split('\n')
			.filter((line) => line.includes('API token missing or wrong'))
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(refusal).toHaveLength(1);
		expect(refusal[0]).toMatchObject({
			level: 'warn',
			requestId: response.headers.get('x-request-id'),
			method: 'GET',
			path: '/api/decks',
			sentToken: true
		});
		expect(logged.join('')).not.toContain('a-guess-that-is-wrong-wrong');
	});

	it('never contains the real token, however many calls were made', async () => {
		logged.length = 0;
		await call('GET', '/api/decks', bearer(TOKEN));
		await call('GET', '/api/decks', { authorization: `Bearer ${TOKEN}x` });
		await call('GET', '/api/decks');
		expect(logged.join('')).not.toContain(TOKEN);
	});
});

describe('under repeated wrong guesses', () => {
	it('keeps refusing the wrong ones and accepting the right one', async () => {
		for (let i = 0; i < 300; i++) {
			const { response } = await call(
				'GET',
				'/api/decks',
				bearer(`guess-${i}-xxxxxxxxxxxxxxxxxxxxxxxx`)
			);
			expect(response.status).toBe(401);
		}
		expect((await call('GET', '/api/decks', bearer(TOKEN))).reached).toBe(true);
	});
});
