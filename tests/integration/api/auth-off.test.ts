import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { closeApp, getApp, initApp } from '#lib/server/app.ts';
import {
	apiTokenGuard,
	authGuard,
	contentTypeGuard,
	hostGuard,
	requestLogging,
	securityHeaders
} from '#lib/server/http/hooks.ts';
import { GET as getStatus } from '../../../src/routes/api/auth/status/+server.ts';
import { POST as postLogin } from '../../../src/routes/api/auth/login/+server.ts';
import { POST as postLogout } from '../../../src/routes/api/auth/logout/+server.ts';
import { POST as postLogoutAll } from '../../../src/routes/api/auth/logout-all/+server.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// ADR-021: with no TESSERA_PASSWORD nothing changes. No redirect, no header, no cookie, and the sign-in routes say so.

let dir: TempDir;
const logged: string[] = [];

type Next = (event: RequestEvent) => Promise<Response>;
type Hook = (input: { event: RequestEvent; resolve: Next }) => Promise<Response>;
const hooks = [
	requestLogging,
	securityHeaders,
	hostGuard,
	authGuard,
	apiTokenGuard,
	contentTypeGuard
] as unknown as Hook[];

beforeAll(() => {
	dir = makeTempDir();
	process.env['DATA_DIR'] = dir.path;
	process.env['LOG_LEVEL'] = 'debug';
	delete process.env['TESSERA_PASSWORD'];
	delete process.env['TESSERA_API_TOKEN'];
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

async function call(
	method: string,
	path: string,
	handler?: (e: RequestEvent) => Promise<Response>
) {
	const hasBody = method !== 'GET';
	const request = new Request(`http://localhost${path}`, {
		method,
		headers: hasBody ? { 'content-type': 'application/json' } : {},
		...(hasBody ? { body: '{}' } : {})
	});
	let reached = false;
	const resolve = async (event: RequestEvent) => {
		reached = true;
		return handler ? await handler(event) : new Response('ok');
	};
	const event = {
		request,
		url: new URL(request.url),
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	const next = (index: number, current: RequestEvent): Promise<Response> =>
		index === hooks.length
			? resolve(current)
			: hooks[index]!({ event: current, resolve: (e) => next(index + 1, e ?? current) });
	const response = await next(0, event);
	return { response, reached };
}

describe('sign-in is off', () => {
	it('says so at startup and builds no sign-in state', () => {
		expect(logged.join('')).toContain('sign-in: off');
		expect(getApp().auth).toBeUndefined();
	});

	it('lets every page and API call through, with no redirect and no cookie', async () => {
		for (const [method, path] of [
			['GET', '/'],
			['GET', '/settings'],
			['GET', '/api/decks'],
			['POST', '/api/decks'],
			['DELETE', '/api/decks/x']
		] as const) {
			const { response, reached } = await call(method, path);
			expect(reached, `${method} ${path}`).toBe(true);
			expect(response.status).toBe(200);
			expect(response.headers.get('set-cookie')).toBeNull();
		}
	});

	it('answers the status route as off and refuses to sign in or out everywhere', async () => {
		const status = await call('GET', '/api/auth/status', (e) =>
			Promise.resolve(getStatus(e) as Response)
		);
		expect(await status.response.json()).toEqual({ enabled: false, signedIn: false });

		const login = await call('POST', '/api/auth/login', (e) =>
			Promise.resolve(postLogin(e) as Response)
		);
		expect(login.response.status).toBe(404);
		expect(login.response.headers.get('set-cookie')).toBeNull();

		const all = await call('POST', '/api/auth/logout-all', (e) =>
			Promise.resolve(postLogoutAll(e) as Response)
		);
		expect(all.response.status).toBe(404);

		const out = await call('POST', '/api/auth/logout', (e) =>
			Promise.resolve(postLogout(e) as Response)
		);
		expect(out.response.status).toBe(200);
		expect(await out.response.json()).toEqual({ enabled: false, signedIn: false });
	});
});
