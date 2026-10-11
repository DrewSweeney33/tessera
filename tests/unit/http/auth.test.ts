import { describe, expect, it } from 'vitest';
import {
	bearerToken,
	isWebPageRequest,
	requiresToken,
	routingPath,
	tokenMatches
} from '#lib/server/http/auth.ts';

// What the browser writes in Origin, and the host and port the server sees in the Host header.
const ORIGIN = 'http://192.168.1.50:3000';
const HOST = '192.168.1.50:3000';
const headers = (init: Record<string, string>) => new Headers(init);

describe('requiresToken: which paths the token protects', () => {
	it.each([
		'/api/decks',
		'/api/import',
		'/api/study/next',
		'/api/study/review',
		'/api/anything',
		'/api/'
	])('protects %s', (path) => {
		expect(requiresToken(path)).toBe(true);
	});

	it('leaves the web app, its files, the health check, and the schema open', () => {
		for (const path of [
			'/',
			'/import',
			'/study/ccna',
			'/_app/immutable/x.js',
			'/healthz',
			'/api/schema',
			'/favicon.ico'
		]) {
			expect(requiresToken(path), path).toBe(false);
		}
	});

	it.each([
		['percent-encoded letters, which the router decodes', '/%61pi/decks'],
		['an encoded first letter in upper case hex', '/%61PI/decks'.replace('PI', 'pi')],
		['encoded letters inside the word', '/ap%69/decks'],
		['an encoded schema-looking path that is really another route', '/api/schem%61x'],
		['a double slash', '//api/decks'.slice(1)],
		['the bare /api', '/api'],
		['a path that does not decode', '/api/%E0%A4%A']
	])('does not let %s past the guard', (_name, path) => {
		expect(requiresToken(path), path).toBe(true);
	});

	it('asks for the token when a path cannot be decoded at all, whatever it starts with', () => {
		for (const path of ['/%E0%A4%A', '/study/%E0', '/%', '/x%zz']) {
			expect(requiresToken(path), path).toBe(true);
		}
	});

	it('only opens the exact schema path', () => {
		expect(requiresToken('/api/schema')).toBe(false);
		expect(requiresToken('/api/schema/')).toBe(true);
		expect(requiresToken('/api/schema/x')).toBe(true);
		expect(requiresToken('/api/schemas')).toBe(true);
		expect(requiresToken('/api/Schema')).toBe(true);
	});

	it('reads an encoded schema path the way the router does', () => {
		expect(requiresToken('/api/sch%65ma')).toBe(false);
	});
});

describe('routingPath', () => {
	it('decodes like the router (SvelteKit decode_pathname): letters and spaces yes, an encoded slash and percent no', () => {
		expect(routingPath('/%61pi/decks')).toBe('/api/decks');
		expect(routingPath('/a%20b')).toBe('/a b');
		expect(routingPath('/api%2Fdecks')).toBe('/api%2Fdecks');
		expect(routingPath('/%2561pi')).toBe('/%2561pi');
	});
});

describe('bearerToken', () => {
	it('reads the token from a Bearer header, whatever the case of the word', () => {
		expect(bearerToken('Bearer abc123')).toBe('abc123');
		expect(bearerToken('bearer abc123')).toBe('abc123');
		expect(bearerToken('BEARER   abc123  ')).toBe('abc123');
		expect(bearerToken('Bearer\tabc123')).toBe('abc123');
	});

	it.each([
		null,
		'',
		'Bearer',
		'Bearer ',
		'abc123',
		'Basic abc123',
		'Token abc123',
		'Bearer a b',
		'Bearerabc'
	])('gives nothing for %j', (value) => {
		expect(bearerToken(value)).toBeUndefined();
	});
});

describe('tokenMatches', () => {
	const expected = 'a'.repeat(32);

	it('accepts only the exact token', () => {
		expect(tokenMatches(expected, expected)).toBe(true);
		expect(tokenMatches(undefined, expected)).toBe(false);
		expect(tokenMatches('', expected)).toBe(false);
		expect(tokenMatches(expected.slice(1), expected)).toBe(false);
		expect(tokenMatches(`${expected}b`, expected)).toBe(false);
		expect(tokenMatches(expected.toUpperCase(), expected)).toBe(false);
		expect(tokenMatches(`${expected} `, expected)).toBe(false);
	});

	it('does not throw for very long or unusual input', () => {
		expect(tokenMatches('x'.repeat(100_000), expected)).toBe(false);
		expect(tokenMatches('\u0000￿😀', expected)).toBe(false);
	});

	it('does not stop at the first differing character', () => {
		// A comparison that returned early would make the time depend on the guess. This only checks the
		// result for tokens that differ at the start, the middle, and the end.
		for (const index of [0, 15, 31]) {
			const guess = expected.slice(0, index) + 'b' + expected.slice(index + 1);
			expect(tokenMatches(guess, expected)).toBe(false);
		}
	});
});

describe('isWebPageRequest', () => {
	it('trusts Sec-Fetch-Site, which only a browser sets', () => {
		expect(isWebPageRequest(headers({ 'sec-fetch-site': 'same-origin' }), HOST)).toBe(true);
	});

	it.each(['same-site', 'cross-site', 'none', '', 'Same-Origin '])(
		'refuses Sec-Fetch-Site %j, even with a matching Origin and the page marker',
		(site) => {
			expect(
				isWebPageRequest(
					headers({ 'sec-fetch-site': site, origin: ORIGIN, 'x-tessera-client': 'web' }),
					HOST
				)
			).toBe(false);
		}
	);

	it('falls back to Origin when Sec-Fetch-Site is missing', () => {
		expect(isWebPageRequest(headers({ origin: ORIGIN }), HOST)).toBe(true);
		expect(isWebPageRequest(headers({ origin: 'http://evil.example' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: 'null' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: `${ORIGIN}/` }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: `${ORIGIN}/path` }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: 'http://user:pw@192.168.1.50:3000' }), HOST)).toBe(
			false
		);
		expect(isWebPageRequest(headers({ origin: 'ftp://192.168.1.50:3000' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: 'not a url' }), HOST)).toBe(false);
		expect(
			isWebPageRequest(headers({ origin: 'http://192.168.1.50:3000.evil.example' }), HOST)
		).toBe(false);
		expect(isWebPageRequest(headers({ origin: 'http://evil.example:3000' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ origin: 'http://192.168.1.50:3001' }), HOST)).toBe(false);
		// The scheme is not compared: behind adapter-node the server thinks it is https whatever the browser used.
		expect(isWebPageRequest(headers({ origin: 'https://192.168.1.50:3000' }), HOST)).toBe(true);
		expect(isWebPageRequest(headers({ origin: ORIGIN }), '192.168.1.50:3000'.toUpperCase())).toBe(
			true
		);
	});

	it('does not let the page marker rescue a mismatched Origin', () => {
		expect(
			isWebPageRequest(headers({ origin: 'http://evil.example', 'x-tessera-client': 'web' }), HOST)
		).toBe(false);
	});

	it('falls back to the page marker when neither header is present, as on plain HTTP', () => {
		expect(isWebPageRequest(headers({ 'x-tessera-client': 'web' }), HOST)).toBe(true);
		expect(isWebPageRequest(headers({ 'x-tessera-client': 'WEB' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({ 'x-tessera-client': '1' }), HOST)).toBe(false);
		expect(isWebPageRequest(headers({}), HOST)).toBe(false);
	});
});
