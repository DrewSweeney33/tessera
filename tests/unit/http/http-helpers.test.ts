import { describe, expect, it } from 'vitest';
import { checkContentType, mediaType } from '#lib/server/http/content-type.ts';
import { withHeaders } from '#lib/server/http/headers.ts';
import { resolveRequestId } from '#lib/server/http/request-id.ts';

describe('mediaType', () => {
	it('strips parameters and normalizes case', () => {
		expect(mediaType('application/json; charset=utf-8')).toBe('application/json');
		expect(mediaType('Application/JSON')).toBe('application/json');
		expect(mediaType(null)).toBe('');
		expect(mediaType('')).toBe('');
	});
});

describe('checkContentType', () => {
	const check = (method: string, path: string, type: string | null) =>
		checkContentType(method, path, type, 'req-1');

	it('ignores requests that do not change state', () => {
		expect(check('GET', '/api/decks', null)).toBeUndefined();
		expect(check('HEAD', '/api/decks', null)).toBeUndefined();
		expect(check('OPTIONS', '/api/import', 'text/plain')).toBeUndefined();
	});

	it('ignores paths outside /api, such as form actions and pages', () => {
		expect(check('POST', '/settings', 'application/x-www-form-urlencoded')).toBeUndefined();
		expect(check('POST', '/apix', 'text/plain')).toBeUndefined();
		expect(check('POST', '/', null)).toBeUndefined();
	});

	it('accepts JSON for any mutating API route, with or without parameters', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(check(method, '/api/study/review', 'application/json')).toBeUndefined();
		}
		expect(check('post', '/api/study/review', 'application/json; charset=utf-8')).toBeUndefined();
	});

	it('also accepts Markdown on the import route only', () => {
		expect(check('POST', '/api/import', 'text/markdown')).toBeUndefined();
		expect(check('POST', '/api/import', 'application/json')).toBeUndefined();
		expect(check('POST', '/api/study/review', 'text/markdown')?.status).toBe(415);
	});

	it('rejects form and plain text types that a cross-site form could send', async () => {
		for (const type of [
			'text/plain',
			'application/x-www-form-urlencoded',
			'multipart/form-data; boundary=x',
			null,
			''
		]) {
			const response = check('POST', '/api/import', type);
			expect(response?.status, String(type)).toBe(415);
		}
		const response = check('POST', '/api/import', 'text/plain')!;
		const body = await response.json();
		expect(body.error.code).toBe('unsupported_media_type');
		expect(body.error.message).toContain('application/json or text/markdown');
		expect(body.error.message).toContain('received text/plain');
		expect(body.error.details.accepted).toEqual(['application/json', 'text/markdown']);
		expect(response.headers.get('x-request-id')).toBe('req-1');
	});

	it('says plainly when no content type was sent', async () => {
		const body = await check('POST', '/api/decks', null)!.json();
		expect(body.error.message).toContain('none was sent');
	});
});

describe('resolveRequestId', () => {
	it('keeps a well-formed id from a proxy', () => {
		expect(resolveRequestId('abc-123_DEF.4')).toBe('abc-123_DEF.4');
	});

	it('replaces missing, oversized, or hostile ids with a fresh UUID', () => {
		const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		for (const bad of [null, '', 'a'.repeat(65), 'has space', 'line\nbreak', '<script>', 'a;b']) {
			expect(resolveRequestId(bad)).toMatch(uuid);
		}
		expect(resolveRequestId(null)).not.toBe(resolveRequestId(null));
	});
});

describe('withHeaders', () => {
	it('sets headers on a normal response in place', () => {
		const response = new Response('ok');
		expect(withHeaders(response, { 'x-test': '1' })).toBe(response);
		expect(response.headers.get('x-test')).toBe('1');
	});

	it('copes with immutable headers by rebuilding the response', () => {
		const redirect = Response.redirect('http://localhost/next', 302);
		const result = withHeaders(redirect, { 'x-test': '1' });
		expect(result.headers.get('x-test')).toBe('1');
		expect(result.status).toBe(302);
		expect(result.headers.get('location')).toBe('http://localhost/next');
	});
});
