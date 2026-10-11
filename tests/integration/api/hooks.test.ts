import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { AppError } from '#lib/server/http/errors.ts';
import { route } from '#lib/server/http/route.ts';
import { closeApp, getApp, initApp } from '#lib/server/app.ts';
import {
	apiTokenGuard,
	contentTypeGuard,
	hostGuard,
	requestLogging,
	securityHeaders
} from '#lib/server/http/hooks.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The hooks use the global app, so this file initializes it once from a temp data directory.
let dir: TempDir;
const logged: string[] = [];

type Next = (event: RequestEvent) => Promise<Response>;
type Hook = (input: { event: RequestEvent; resolve: Next }) => Promise<Response>;

// The same order as hooks.server.ts. Kit's sequence() needs its request store, so it is composed by hand.
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
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
		logged.push(String(chunk));
		return true;
	});
	initApp();
});

afterAll(() => {
	vi.restoreAllMocks();
	closeApp();
	dir.cleanup();
});

function run(request: Request, resolveWith: () => Response = () => new Response('page')) {
	const resolve = vi.fn(async () => resolveWith());
	const event = {
		request,
		url: new URL(request.url),
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	return {
		resolve,
		event,
		response: handle({ event, resolve })
	};
}

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
	new Request(`http://localhost${path}`, { method, headers });

describe('handle hook chain', () => {
	it('adds a request id and security headers to normal responses', async () => {
		const { response, resolve } = run(req('GET', '/'));
		const result = await response;
		expect(resolve).toHaveBeenCalledOnce();
		expect(result.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect(result.headers.get('referrer-policy')).toBe('no-referrer');
		expect(result.headers.has('cache-control')).toBe(false);
	});

	it('keeps a valid request id from a proxy and replaces a hostile one', async () => {
		expect(
			(await run(req('GET', '/', { 'x-request-id': 'proxy-42' })).response).headers.get(
				'x-request-id'
			)
		).toBe('proxy-42');
		const replaced = (
			await run(req('GET', '/', { 'x-request-id': 'bad id!' })).response
		).headers.get('x-request-id');
		expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('sets no-store on API responses that do not choose their own caching', async () => {
		const plain = await run(req('GET', '/api/decks')).response;
		expect(plain.headers.get('cache-control')).toBe('no-store');
		const cached = await run(
			req('GET', '/api/schema'),
			() => new Response('{}', { headers: { 'cache-control': 'public, max-age=300' } })
		).response;
		expect(cached.headers.get('cache-control')).toBe('public, max-age=300');
	});

	it('rejects a mutating API call with the wrong content type before it reaches any route', async () => {
		const { response, resolve } = run(req('POST', '/api/import', { 'content-type': 'text/plain' }));
		const result = await response;
		expect(result.status).toBe(415);
		expect(resolve).not.toHaveBeenCalled();
		expect(result.headers.get('x-request-id')).toBeTruthy();
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await result.json()).error.code).toBe('unsupported_media_type');
	});

	it('lets a correct JSON call through', async () => {
		const { response, resolve } = run(
			req('POST', '/api/import', { 'content-type': 'application/json' })
		);
		expect((await response).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('asks for no token when none is configured: the API is open to any caller, as before', async () => {
		for (const headers of [
			{},
			{ authorization: 'Bearer anything' },
			{ 'sec-fetch-site': 'cross-site' }
		]) {
			const { response, resolve } = run(req('GET', '/api/decks', headers));
			expect((await response).status, JSON.stringify(headers)).toBe(200);
			expect(resolve).toHaveBeenCalledOnce();
		}
	});

	it('does not interfere with form posts outside /api', async () => {
		const { response, resolve } = run(
			req('POST', '/settings', { 'content-type': 'application/x-www-form-urlencoded' })
		);
		expect((await response).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('logs each request once, quietly for health checks, without query strings', async () => {
		logged.length = 0;
		await run(req('GET', '/api/decks?secret=abc')).response;
		await run(req('GET', '/healthz')).response;
		const lines = logged.map((l) => JSON.parse(l) as Record<string, unknown>);
		const api = lines.find((l) => l['path'] === '/api/decks')!;
		expect(api).toMatchObject({ msg: 'request', level: 'info', method: 'GET', status: 200 });
		expect(JSON.stringify(lines)).not.toContain('secret');
		expect(lines.find((l) => l['path'] === '/healthz')).toMatchObject({ level: 'debug' });
	});
});

describe('route wrapper', () => {
	const event = (requestId = 'req-9') =>
		({ locals: { requestId }, url: new URL('http://localhost/api/x') }) as unknown as RequestEvent;

	it('passes a successful response through', async () => {
		const handler = route(() => new Response('fine'));
		expect(await (await handler(event())).text()).toBe('fine');
	});

	it('turns an AppError into the standard error response', async () => {
		const handler = route(() => {
			throw new AppError('not_found', 'No such deck', { deck: 'x' });
		});
		const response = await handler(event());
		expect(response.status).toBe(404);
		expect(response.headers.get('x-request-id')).toBe('req-9');
		expect(await response.json()).toEqual({
			error: { code: 'not_found', message: 'No such deck', details: { deck: 'x' } }
		});
	});

	it('hides unexpected errors from the client and logs them', async () => {
		logged.length = 0;
		const handler = route(async () => {
			throw new Error('SQLITE_CORRUPT in /data/tessera.db');
		});
		const response = await handler(event());
		expect(response.status).toBe(500);
		const text = JSON.stringify(await response.json());
		expect(text).toContain('internal_error');
		expect(text).not.toContain('SQLITE');
		const line = logged
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.find((l) => l['msg'] === 'unhandled error in route')!;
		expect(line).toMatchObject({ level: 'error', requestId: 'req-9', route: '/api/x' });
		expect(String(line['error'])).toContain('SQLITE_CORRUPT');
	});

	it('uses the initialized app', () => {
		expect(getApp().version).toEqual(expect.any(String));
	});
});

describe('hostGuard (DNS rebinding)', () => {
	const at = (
		host: string,
		path = '/api/decks',
		method = 'GET',
		headers: Record<string, string> = {}
	) => new Request(`http://${host}${path}`, { method, headers });

	it('refuses a request for a name the server is not meant to answer to', async () => {
		const { response, resolve } = run(at('attacker.example:3000'));
		const result = await response;
		expect(result.status).toBe(421);
		expect(resolve).not.toHaveBeenCalled();
		const body = (await result.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('misdirected_request');
		expect(body.error.message).toContain('"attacker.example:3000"');
		expect(body.error.message).toContain('TESSERA_ALLOWED_HOSTS');
		expect(body.error.message).toContain('docs/deploy.md');
	});

	it('still sends the security headers and the request id on a refusal', async () => {
		const result = await run(at('attacker.example'), undefined).response;
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect(result.headers.get('referrer-policy')).toBe('no-referrer');
		expect(result.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._-]+$/);
	});

	it('refuses writes too, even with a correct JSON content type', async () => {
		const { response, resolve } = run(
			at('127.0.0.1.nip.io', '/api/import', 'POST', { 'content-type': 'application/json' })
		);
		expect((await response).status).toBe(421);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('refuses the names a rebinding attack uses, whatever the path', async () => {
		for (const host of [
			'7f000001.c0a80001.rbndr.us',
			'localhost.evil.com',
			'tessera.lan.evil.com'
		]) {
			for (const path of ['/', '/api/decks', '/api/schema', '/import']) {
				const result = await run(at(host, path)).response;
				expect(result.status, `${host}${path}`).toBe(421);
			}
		}
	});

	it('answers the names it is meant for', async () => {
		for (const host of [
			'localhost',
			'localhost:3000',
			'127.0.0.1:3000',
			'192.168.30.99:3000',
			'[::1]:3000',
			'tessera',
			'tessera.lan',
			'nas.home.arpa:3000'
		]) {
			const { response, resolve } = run(at(host));
			expect((await response).status, host).toBe(200);
			expect(resolve, host).toHaveBeenCalledOnce();
		}
	});

	it('lets /healthz answer under any name, so monitors and the Docker health check work', async () => {
		const { response, resolve } = run(at('monitor.example.com', '/healthz'));
		expect((await response).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('does not exempt other paths that merely start like /healthz', async () => {
		expect((await run(at('attacker.example', '/healthz/../api/decks')).response).status).toBe(421);
		expect((await run(at('attacker.example', '/healthzz')).response).status).toBe(421);
	});

	it('logs the refusal without anything but the host name', async () => {
		logged.length = 0;
		await run(at('attacker.example')).response;
		const line = logged
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.find((l) => l['msg'] === 'request refused, host name not allowed')!;
		expect(line).toMatchObject({ level: 'warn', host: 'attacker.example' });
		expect(Object.keys(line).sort()).toEqual(['host', 'level', 'msg', 'requestId', 'time']);
	});
});
