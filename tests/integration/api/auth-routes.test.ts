import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { closeApp, getApp, initApp } from '#lib/server/app.ts';
import { makeSessionValue, SESSION_COOKIE } from '#lib/server/auth/index.ts';
import { nowSeconds } from '#lib/server/auth/request.ts';
import {
	apiTokenGuard,
	authGuard,
	contentTypeGuard,
	hostGuard,
	requestLogging,
	securityHeaders
} from '#lib/server/http/hooks.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// ADR-021: every route of the app is closed without a login, except the ones decided here. This lists the routes the
// app has, so a route added later fails this test until someone writes it into the table below and chooses: open
// (rare, and needs a reason) or closed (the default, which needs no code). The guard closes a new route anyway, this
// is the check that nobody opened one by accident and that the list of routes is known.

// The routes that stay open when sign-in is on, with the reason each one is.
const OPEN = new Set([
	'GET /healthz', // the Docker health check and monitors: the version and a database check, nothing else
	'GET /login', // the page that asks for the password
	'GET /api/schema', // the public deck format, as before
	'GET /api/auth/status', // whether sign-in is on and whether this browser is in: tells nothing a stranger could use
	'POST /api/auth/login', // how a person gets in
	'POST /api/auth/logout' // clears this device's cookie; nothing to learn or change without one
]);

// Every route the app has. Add a line when you add a route.
const API_ROUTES = [
	'/api/auth/login',
	'/api/auth/logout',
	'/api/auth/logout-all',
	'/api/auth/status',
	'/api/backups',
	'/api/backups/[name]',
	'/api/backups/[name]/preview',
	'/api/backups/[name]/restore',
	'/api/cards/[cardPk]/suspend',
	'/api/cards/[cardPk]/unsuspend',
	'/api/decks',
	'/api/decks/[id]',
	'/api/decks/[id]/delete-forever',
	'/api/decks/[id]/export',
	'/api/decks/[id]/restore',
	'/api/decks/[id]/start-over',
	'/api/decks/[id]/trash',
	'/api/folder-assignments',
	'/api/folders',
	'/api/folders/[id]',
	'/api/folders/[id]/stats',
	'/api/import',
	'/api/leeches',
	'/api/leeches/[cardPk]/[ordinal]/reset',
	'/api/practice/grade',
	'/api/practice/item',
	'/api/practice/pool',
	'/api/practice/start',
	'/api/practice/undo',
	'/api/report/weak-spots',
	'/api/schema',
	'/api/settings',
	'/api/stats',
	'/api/study/next',
	'/api/study/review',
	'/api/study/undo',
	'/api/trash',
	'/healthz'
];

const PAGES = [
	'/',
	'/backups',
	'/decks/[id]/edit',
	'/decks/new',
	'/import',
	'/leeches',
	'/login',
	'/practice',
	'/settings',
	'/stats',
	'/study/[[deckId]]',
	'/trash'
];

const serverFiles = import.meta.glob<Record<string, unknown>>('/src/routes/**/+server.ts');
const pageFiles = Object.keys(import.meta.glob('/src/routes/**/+page.svelte', { query: '?raw' }));

const patternOf = (file: string, tail: string) =>
	file.replace('/src/routes', '').replace(tail, '') || '/';
const concrete = (pattern: string) => pattern.replace(/\[\[?[^\]]+\]\]?/g, '1');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

let dir: TempDir;

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
	process.env['LOG_LEVEL'] = 'error';
	process.env['TESSERA_PASSWORD'] = 'correct horse battery staple';
	initApp();
});

afterAll(() => {
	closeApp();
	delete process.env['TESSERA_PASSWORD'];
	dir.cleanup();
});

async function call(method: string, path: string, cookie?: string) {
	const changes = method !== 'GET';
	const request = new Request(`http://localhost${path}`, {
		method,
		headers: {
			'x-tessera-client': 'web',
			...(changes ? { 'content-type': 'application/json' } : {}),
			...(cookie ? { cookie } : {})
		},
		...(changes ? { body: '{}' } : {})
	});
	let reached = false;
	const event = {
		request,
		url: new URL(request.url),
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	const next = (index: number, current: RequestEvent): Promise<Response> =>
		index === hooks.length
			? Promise.resolve(((reached = true), new Response('ok')))
			: hooks[index]!({ event: current, resolve: (e) => next(index + 1, e ?? current) });
	const response = await next(0, event);
	return { response, reached };
}

describe('the routes the app has', () => {
	it('are the ones listed in this test, so a new route is decided on purpose', () => {
		const found = Object.keys(serverFiles)
			.map((file) => patternOf(file, '/+server.ts'))
			.sort();
		expect(
			found,
			'a route was added or removed: list it in API_ROUTES and decide if it is open'
		).toEqual([...API_ROUTES].sort());
	});

	it('include the pages listed in this test', () => {
		const found = pageFiles.map((file) => patternOf(file, '/+page.svelte')).sort();
		expect(found, 'a page was added or removed: list it in PAGES').toEqual([...PAGES].sort());
	});

	it('only open what OPEN names, and every open route exists', () => {
		for (const entry of OPEN) {
			const [, path] = entry.split(' ') as [string, string];
			expect([...API_ROUTES, ...PAGES], entry).toContain(path);
		}
	});
});

describe('with sign-in on', () => {
	it('every API route and method is refused without a login, except the open ones', async () => {
		for (const [file, load] of Object.entries(serverFiles)) {
			const pattern = patternOf(file, '/+server.ts');
			const module = await load();
			const methods = METHODS.filter((method) => typeof module[method] === 'function');
			expect(methods.length, pattern).toBeGreaterThan(0);
			for (const method of methods) {
				const { response, reached } = await call(method, concrete(pattern));
				const label = `${method} ${pattern}`;
				if (OPEN.has(label)) {
					expect(reached, label).toBe(true);
				} else {
					expect(reached, label).toBe(false);
					expect(response.status, label).toBe(401);
					const body = await response.json();
					expect(body.error.details?.reason, label).toBe('sign_in_required');
				}
			}
		}
	});

	it('every API route and method is reached with a login', async () => {
		const app = getApp();
		const cookie = `${SESSION_COOKIE}=${makeSessionValue(app.auth!.key, 0, nowSeconds(app))}`;
		for (const [file, load] of Object.entries(serverFiles)) {
			const pattern = patternOf(file, '/+server.ts');
			const module = await load();
			for (const method of METHODS.filter((m) => typeof module[m] === 'function')) {
				const { reached } = await call(method, concrete(pattern), cookie);
				expect(reached, `${method} ${pattern}`).toBe(true);
			}
		}
	});

	it('refuses a method the route does not have, even to a stranger on an open path', async () => {
		for (const [method, path] of [
			['POST', '/healthz'],
			['PUT', '/api/schema'],
			['DELETE', '/api/auth/status']
		] as const) {
			const { reached } = await call(method, path);
			expect(reached, `${method} ${path}`).toBe(false);
		}
	});

	it('sends every page to the login, except the login itself', async () => {
		for (const pattern of PAGES) {
			const { response, reached } = await call('GET', concrete(pattern));
			if (pattern === '/login') {
				expect(reached, pattern).toBe(true);
				continue;
			}
			expect(reached, pattern).toBe(false);
			expect(response.status, pattern).toBe(303);
			expect(response.headers.get('location'), pattern).toMatch(/^\/login\?next=%2F/);
		}
	});

	it('does not reveal which paths exist: an unknown page also goes to the login', async () => {
		const { response, reached } = await call('GET', '/no-such-page');
		expect(reached).toBe(false);
		expect(response.status).toBe(303);
	});
});
