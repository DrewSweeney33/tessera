import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { closeApp, getApp, initApp } from '#lib/server/app.ts';
import {
	SESSION_COOKIE,
	SESSION_RENEW_AFTER_SECONDS,
	deriveSessionKey,
	makeSessionValue
} from '#lib/server/auth/index.ts';
import { nowSeconds } from '#lib/server/auth/request.ts';
import {
	apiTokenGuard,
	authGuard,
	contentTypeGuard,
	hostGuard,
	requestLogging,
	securityHeaders
} from '#lib/server/http/hooks.ts';
import { getSessionEpoch, getSettings } from '#lib/server/repos/settings.ts';
import { GET as getStatus } from '../../../src/routes/api/auth/status/+server.ts';
import { POST as postLogin } from '../../../src/routes/api/auth/login/+server.ts';
import { POST as postLogout } from '../../../src/routes/api/auth/logout/+server.ts';
import { POST as postLogoutAll } from '../../../src/routes/api/auth/logout-all/+server.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// ADR-021: with TESSERA_PASSWORD set, every page and API route needs a login (or the API token), except a few. This runs
// the real guards in the real order and the real /api/auth routes against a server with a password and a token.

const PASSWORD = 'correct horse battery staple';
const TOKEN = 'k3y-0123456789abcdef0123456789abcdef';
let dir: TempDir;
const logged: string[] = [];
// Every wait the slow-down asked for, in order. The test never actually waits.
const waits: number[] = [];

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

const ROUTES: Record<string, RequestHandler | undefined> = {
	'GET /api/auth/status': getStatus,
	'POST /api/auth/login': postLogin,
	'POST /api/auth/logout': postLogout,
	'POST /api/auth/logout-all': postLogoutAll
};

beforeAll(() => {
	dir = makeTempDir();
	process.env['DATA_DIR'] = dir.path;
	process.env['LOG_LEVEL'] = 'debug';
	process.env['TESSERA_PASSWORD'] = PASSWORD;
	process.env['TESSERA_API_TOKEN'] = TOKEN;
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
		logged.push(String(chunk));
		return true;
	});
	initApp();
	const app = getApp();
	app.auth = {
		...app.auth!,
		sleep: async (ms) => {
			waits.push(ms);
		}
	};
});

afterAll(() => {
	vi.restoreAllMocks();
	closeApp();
	delete process.env['TESSERA_PASSWORD'];
	delete process.env['TESSERA_API_TOKEN'];
	dir.cleanup();
});

const ORIGIN = 'http://localhost';
const PAGE = { 'x-tessera-client': 'web' };

interface Sent {
	headers?: Record<string, string>;
	body?: unknown;
	rawBody?: string;
}

async function call(method: string, path: string, sent: Sent = {}) {
	const body = sent.rawBody ?? (sent.body === undefined ? undefined : JSON.stringify(sent.body));
	const headers: Record<string, string> = { ...sent.headers };
	if (body !== undefined && !('content-type' in headers))
		headers['content-type'] = 'application/json';
	const request = new Request(`${ORIGIN}${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body })
	});
	let reached = false;
	const resolve = async (event: RequestEvent) => {
		reached = true;
		const handler = ROUTES[`${method} ${event.url.pathname}`];
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

function cookieOf(response: Response): string {
	const header = response.headers.get('set-cookie');
	if (!header) throw new Error('no Set-Cookie');
	return header.split(';')[0]!;
}

async function signIn(headers: Record<string, string> = {}): Promise<string> {
	const { response } = await call('POST', '/api/auth/login', {
		headers,
		body: { password: PASSWORD }
	});
	expect(response.status).toBe(200);
	return cookieOf(response);
}

async function errorOf(response: Response) {
	return (await response.json()).error as {
		code: string;
		message: string;
		details?: { reason?: string };
	};
}

describe('sign-in is on', () => {
	it('is announced at startup without printing the password or the token', () => {
		const startup = logged.join('');
		expect(startup).toContain('sign-in: on');
		expect(startup).not.toContain(PASSWORD);
		expect(startup).not.toContain(TOKEN);
	});

	it('refuses an API call with no login, naming the reason the page acts on', async () => {
		const { response, reached } = await call('GET', '/api/decks', { headers: PAGE });
		expect(reached).toBe(false);
		expect(response.status).toBe(401);
		const error = await errorOf(response);
		expect(error.code).toBe('unauthorized');
		expect(error.details?.reason).toBe('sign_in_required');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('no longer lets the web page alone through (the page needs the cookie)', async () => {
		for (const headers of [PAGE, { 'sec-fetch-site': 'same-origin' }, { origin: ORIGIN }]) {
			const { response, reached } = await call('GET', '/api/decks', { headers });
			expect(reached).toBe(false);
			expect(response.status).toBe(401);
		}
	});

	it('sends a page to the login with where it was going, as a path only', async () => {
		const { response, reached } = await call('GET', '/decks/abc?tab=cards');
		expect(reached).toBe(false);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?next=%2Fdecks%2Fabc%3Ftab%3Dcards');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('never builds a next that leaves the site or comes back to the login', async () => {
		for (const path of ['//evil.example/x', '/login/', '/api/x/']) {
			const { response } = await call('GET', path);
			if (response.status === 303) {
				expect(response.headers.get('location')).toBe('/login?next=%2F');
			}
		}
	});

	it('refuses a page request that is not a plain read with a 401 instead of a redirect', async () => {
		const { response } = await call('POST', '/settings', { body: {} });
		expect(response.status).toBe(401);
	});

	it('keeps the few open routes open, each for its own method only', async () => {
		for (const [method, path] of [
			['GET', '/healthz'],
			['GET', '/login'],
			['GET', '/api/schema'],
			['GET', '/api/auth/status'],
			['POST', '/api/auth/logout']
		] as const) {
			const { reached } = await call(method, path, {
				headers: PAGE,
				...(method === 'GET' ? {} : { body: {} })
			});
			expect(reached, `${method} ${path}`).toBe(true);
		}
		for (const [method, path] of [
			['POST', '/healthz'],
			['POST', '/login'],
			['POST', '/api/auth/status'],
			['GET', '/api/auth/login'],
			['GET', '/api/auth/logout'],
			['DELETE', '/api/auth/logout'],
			['GET', '/api/auth/logout-all'],
			['POST', '/api/auth/logout-all']
		] as const) {
			const { reached } = await call(method, path, {
				headers: PAGE,
				...(method === 'GET' ? {} : { body: {} })
			});
			expect(reached, `${method} ${path}`).toBe(false);
		}
	});

	it('does not let an encoded path slip past', async () => {
		const { response, reached } = await call('GET', '/%61pi/decks', { headers: PAGE });
		expect(reached).toBe(false);
		expect(response.status).toBe(401);
	});
});

describe('the API token', () => {
	it('opens the API for a script, with or without sign-in', async () => {
		const { reached } = await call('GET', '/api/decks', {
			headers: { authorization: `Bearer ${TOKEN}` }
		});
		expect(reached).toBe(true);
		const post = await call('POST', '/api/decks', {
			headers: { authorization: `Bearer ${TOKEN}` },
			body: {}
		});
		expect(post.reached).toBe(true);
	});

	it('does not open a page, and a wrong token opens nothing', async () => {
		const page = await call('GET', '/settings', { headers: { authorization: `Bearer ${TOKEN}` } });
		expect(page.response.status).toBe(303);
		const wrong = await call('GET', '/api/decks', { headers: { authorization: 'Bearer nope' } });
		expect(wrong.response.status).toBe(401);
		expect(wrong.reached).toBe(false);
	});
});

describe('signing in', () => {
	it('answers a wrong password with 401 and no cookie, and does not say why', async () => {
		const { response } = await call('POST', '/api/auth/login', {
			headers: PAGE,
			body: { password: 'wrong password entirely' }
		});
		expect(response.status).toBe(401);
		expect(response.headers.get('set-cookie')).toBeNull();
		const error = await errorOf(response);
		expect(error.code).toBe('invalid_password');
		expect(JSON.stringify(error)).not.toContain('wrong password entirely');
	});

	it('gives the same answer for a password that could never be right (too long, empty)', async () => {
		for (const password of ['', 'x'.repeat(300)]) {
			const { response } = await call('POST', '/api/auth/login', { body: { password } });
			expect(response.status).toBe(401);
			expect((await errorOf(response)).code).toBe('invalid_password');
		}
	});

	it('answers the right password with a cookie: HttpOnly, SameSite=Lax, a path, 400 days, not Secure over HTTP', async () => {
		const { response } = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ enabled: true, signedIn: true });
		const header = response.headers.get('set-cookie')!;
		expect(header).toContain(`${SESSION_COOKIE}=v1.`);
		expect(header).toContain('HttpOnly');
		expect(header).toContain('SameSite=Lax');
		expect(header).toContain('Path=/');
		expect(header).toContain('Max-Age=34560000');
		expect(header).not.toContain('Secure');
	});

	it('marks the cookie Secure when the proxy or the browser says HTTPS', async () => {
		const proxied = await call('POST', '/api/auth/login', {
			headers: { 'x-forwarded-proto': 'https' },
			body: { password: PASSWORD }
		});
		expect(proxied.response.headers.get('set-cookie')).toContain('; Secure');
		const direct = await call('POST', '/api/auth/login', {
			headers: { origin: 'https://tessera.example' },
			body: { password: PASSWORD }
		});
		expect(direct.response.headers.get('set-cookie')).toContain('; Secure');
		const plain = await call('POST', '/api/auth/login', {
			headers: { 'x-forwarded-proto': 'http', origin: ORIGIN },
			body: { password: PASSWORD }
		});
		expect(plain.response.headers.get('set-cookie')).not.toContain('Secure');
	});

	it('never logs the password or the cookie', async () => {
		const cookie = await signIn();
		await call('POST', '/api/auth/login', { body: { password: 'a wrong guess to log' } });
		const text = logged.join('');
		expect(text).toContain('signed in');
		expect(text).toContain('sign-in failed');
		expect(text).not.toContain(PASSWORD);
		expect(text).not.toContain(cookie.split('=')[1]!);
		expect(text).not.toContain('a wrong guess to log');
	});

	it('rejects a body that is too large, not JSON, the wrong shape, or has an extra field', async () => {
		const large = await call('POST', '/api/auth/login', {
			rawBody: JSON.stringify({ password: 'x'.repeat(2000) })
		});
		expect(large.response.status).toBe(413);
		const notJson = await call('POST', '/api/auth/login', { rawBody: 'password=abc' });
		expect(notJson.response.status).toBe(400);
		for (const body of [
			{},
			{ password: 5 },
			{ password: null },
			[],
			'text',
			{ password: PASSWORD, extra: 1 }
		]) {
			const { response } = await call('POST', '/api/auth/login', { body });
			expect(response.status, JSON.stringify(body)).toBe(422);
		}
	});

	it('needs the JSON content type like every other changing call', async () => {
		const { response } = await call('POST', '/api/auth/login', {
			headers: { 'content-type': 'text/plain' },
			rawBody: JSON.stringify({ password: PASSWORD })
		});
		expect(response.status).toBe(415);
	});
});

describe('a login', () => {
	it('opens the API and the pages', async () => {
		const cookie = await signIn();
		const api = await call('GET', '/api/decks', { headers: { cookie } });
		expect(api.reached).toBe(true);
		const page = await call('GET', '/settings', { headers: { cookie } });
		expect(page.reached).toBe(true);
	});

	it('is reported by the status route, which anyone can ask', async () => {
		const anonymous = await call('GET', '/api/auth/status');
		expect(await anonymous.response.json()).toEqual({ enabled: true, signedIn: false });
		const cookie = await signIn();
		const signed = await call('GET', '/api/auth/status', { headers: { cookie } });
		expect(await signed.response.json()).toEqual({ enabled: true, signedIn: true });
	});

	it('lets a change through only when it looks like the Tessera page', async () => {
		const cookie = await signIn();
		const bare = await call('POST', '/api/decks', { headers: { cookie }, body: {} });
		expect(bare.reached).toBe(false);
		expect(bare.response.status).toBe(403);
		expect((await errorOf(bare.response)).code).toBe('forbidden');
		const crossSite = await call('POST', '/api/decks', {
			headers: { cookie, 'sec-fetch-site': 'cross-site', ...PAGE },
			body: {}
		});
		expect(crossSite.response.status).toBe(403);
		const otherOrigin = await call('DELETE', '/api/decks/x', {
			headers: { cookie, origin: 'http://evil.example' }
		});
		expect(otherOrigin.response.status).toBe(403);
		for (const headers of [PAGE, { 'sec-fetch-site': 'same-origin' }, { origin: ORIGIN }]) {
			const ok = await call('POST', '/api/decks', { headers: { cookie, ...headers }, body: {} });
			expect(ok.reached).toBe(true);
		}
	});

	it('is refused when forged, cut short, from another password, or from another counter', async () => {
		const good = (await signIn()).split('=')[1]!;
		const other = makeSessionValue(
			deriveSessionKey('some other long password'),
			0,
			nowSeconds(getApp())
		);
		const wrongEpoch = makeSessionValue(getApp().auth!.key, 7, nowSeconds(getApp()));
		const forged = [
			good.slice(0, -2),
			`${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`,
			other,
			wrongEpoch,
			'v1',
			'',
			'x'.repeat(500)
		];
		for (const value of forged) {
			const { response, reached } = await call('GET', '/api/decks', {
				headers: { cookie: `${SESSION_COOKIE}=${value}` }
			});
			expect(reached, value.slice(0, 20)).toBe(false);
			expect(response.status).toBe(401);
		}
	});

	it('is renewed after thirty days of use and not before', async () => {
		const app = getApp();
		const epoch = getSessionEpoch(app.db);
		const old = makeSessionValue(
			app.auth!.key,
			epoch,
			nowSeconds(app) - SESSION_RENEW_AFTER_SECONDS - 60
		);
		const renewed = await call('GET', '/api/decks', {
			headers: { cookie: `${SESSION_COOKIE}=${old}` }
		});
		expect(renewed.reached).toBe(true);
		const fresh = renewed.response.headers.get('set-cookie')!;
		expect(fresh).toContain('Max-Age=34560000');
		expect(fresh.split(';')[0]!.split('=')[1]).not.toBe(old);
		const again = await call('GET', '/api/decks', { headers: { cookie: fresh.split(';')[0]! } });
		expect(again.response.headers.get('set-cookie')).toBeNull();

		const recent = makeSessionValue(app.auth!.key, epoch, nowSeconds(app) - 86_400);
		const kept = await call('GET', '/api/decks', {
			headers: { cookie: `${SESSION_COOKIE}=${recent}` }
		});
		expect(kept.reached).toBe(true);
		expect(kept.response.headers.get('set-cookie')).toBeNull();
	});
});

describe('signing out', () => {
	it('clears the cookie on this device, and works when nobody is signed in', async () => {
		const cookie = await signIn();
		for (const headers of [{ cookie }, {}]) {
			const { response } = await call('POST', '/api/auth/logout', { headers, body: {} });
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ enabled: true, signedIn: false });
			const header = response.headers.get('set-cookie')!;
			expect(header).toContain(`${SESSION_COOKIE}=;`);
			expect(header).toContain('Max-Age=0');
		}
	});

	it('leaves a copied cookie working (the accepted limit of one-device sign-out)', async () => {
		const cookie = await signIn();
		await call('POST', '/api/auth/logout', { headers: { cookie }, body: {} });
		const copy = await call('GET', '/api/decks', { headers: { cookie } });
		expect(copy.reached).toBe(true);
	});

	it('everywhere: refuses every earlier cookie, accepts a new sign-in, and persists the counter', async () => {
		const app = getApp();
		const phone = await signIn();
		const laptop = await signIn();
		const before = getSessionEpoch(app.db);
		const { response } = await call('POST', '/api/auth/logout-all', {
			headers: { cookie: phone, ...PAGE },
			body: {}
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
		expect(getSessionEpoch(app.db)).toBe(before + 1);
		for (const cookie of [phone, laptop]) {
			const refused = await call('GET', '/api/decks', { headers: { cookie } });
			expect(refused.reached).toBe(false);
			expect(refused.response.status).toBe(401);
		}
		const again = await signIn();
		expect((await call('GET', '/api/decks', { headers: { cookie: again } })).reached).toBe(true);
		expect(logged.join('')).toContain('signed out everywhere');
	});

	it('everywhere needs a login, not only the token, and a page-like request', async () => {
		const token = await call('POST', '/api/auth/logout-all', {
			headers: { authorization: `Bearer ${TOKEN}` },
			body: {}
		});
		expect(token.response.status).toBe(401);
		expect((await errorOf(token.response)).details?.reason).toBe('sign_in_required');
		const none = await call('POST', '/api/auth/logout-all', { body: {} });
		expect(none.response.status).toBe(401);
		const cookie = await signIn();
		const script = await call('POST', '/api/auth/logout-all', { headers: { cookie }, body: {} });
		expect(script.response.status).toBe(403);
	});

	it('keeps the counter out of the settings the page can read or write', () => {
		expect(Object.keys(getSettings(getApp().db))).not.toContain('auth.sessionEpoch');
	});
});

describe('wrong guesses wait, they do not lock', () => {
	it('starts waiting at the third wrong guess, doubles, makes the right password wait too, and forgives on success', async () => {
		const app = getApp();
		app.auth!.throttle.recordSuccess();
		waits.length = 0;
		const wrong = () =>
			call('POST', '/api/auth/login', { body: { password: 'nope nope nope nope' } });
		for (let i = 0; i < 5; i += 1) expect((await wrong()).response.status).toBe(401);
		// Five wrong guesses in a row: 0, 0, 0, then 500, 1000 (the delay is for the one being answered).
		expect(waits).toEqual([500, 1000]);

		waits.length = 0;
		const right = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
		expect(right.response.status).toBe(200);
		expect(waits).toEqual([2000]);

		waits.length = 0;
		const after = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
		expect(after.response.status).toBe(200);
		expect(waits).toEqual([]);
	});

	it('turns away the twenty-first attempt that is already waiting with a 429', async () => {
		const app = getApp();
		for (let i = 0; i < 3; i += 1) app.auth!.throttle.recordFailure();
		const release: (() => void)[] = [];
		app.auth = {
			...app.auth!,
			sleep: () => new Promise<void>((resolve) => release.push(resolve))
		};
		try {
			const waiting = Array.from({ length: 20 }, () =>
				call('POST', '/api/auth/login', { body: { password: PASSWORD } })
			);
			await vi.waitFor(() => expect(release).toHaveLength(20));
			const extra = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
			expect(extra.response.status).toBe(429);
			expect(extra.response.headers.get('retry-after')).toBe('30');
			expect((await errorOf(extra.response)).code).toBe('too_many_requests');
			release.forEach((go) => go());
			const done = await Promise.all(waiting);
			expect(done.map((d) => d.response.status)).toEqual(Array(20).fill(200));
		} finally {
			app.auth = {
				...app.auth!,
				sleep: async (ms) => {
					waits.push(ms);
				}
			};
			app.auth.throttle.recordSuccess();
		}
	});
});
