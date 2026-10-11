import { describe, expect, it } from 'vitest';
import { readBodyText } from '#lib/server/http/body.ts';

// Builds a request whose body arrives as the given chunks with no Content-Length, like chunked transfer.
function chunked(chunks: (string | Uint8Array | Error)[]): Request {
	const encoder = new TextEncoder();
	let index = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			const next = chunks[index++];
			if (next === undefined) controller.close();
			else if (next instanceof Error) controller.error(next);
			else controller.enqueue(typeof next === 'string' ? encoder.encode(next) : next);
		}
	});
	return new Request('http://localhost/api/import', {
		method: 'POST',
		body: stream,
		duplex: 'half'
	} as RequestInit);
}

async function body(request: Request, max: number) {
	return readBodyText(request, max, 'Too big.', 'req-1');
}

describe('readBodyText', () => {
	it('returns the text of a small body, including multi-byte characters', async () => {
		expect(await body(chunked(['héllo ', '\u{1F600} world']), 100)).toBe('héllo \u{1F600} world');
	});

	it('returns an empty string for a request with no body', async () => {
		expect(await body(new Request('http://localhost/x', { method: 'POST' }), 10)).toBe('');
	});

	it('accepts a body exactly at the limit', async () => {
		expect(await body(chunked(['a'.repeat(10)]), 10)).toBe('a'.repeat(10));
	});

	it('rejects a body one byte over the limit when no length is declared', async () => {
		const result = await body(chunked(['a'.repeat(6), 'a'.repeat(5)]), 10);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(413);
		expect(await (result as Response).json()).toMatchObject({
			error: { code: 'payload_too_large' }
		});
	});

	it('counts bytes, not characters', async () => {
		// Four 3-byte characters are 12 bytes but only 4 characters.
		const result = await body(chunked(['€€€€']), 10);
		expect((result as Response).status).toBe(413);
	});

	it('trusts a declared length that is already too large without reading the body', async () => {
		const request = new Request('http://localhost/x', {
			method: 'POST',
			headers: { 'content-length': '999999' },
			body: 'x'
		});
		expect(((await body(request, 100)) as Response).status).toBe(413);
	});

	it('stops reading as soon as the limit is passed', async () => {
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled++;
				controller.enqueue(new Uint8Array(1024));
			}
		});
		const request = new Request('http://localhost/x', {
			method: 'POST',
			body: stream,
			duplex: 'half'
		} as RequestInit);
		const result = await body(request, 4096);
		expect((result as Response).status).toBe(413);
		// An endless stream must not be consumed to the end.
		expect(pulled).toBeLessThan(20);
	});

	it('turns the adapter size-limit error into a 413 instead of a 500', async () => {
		const result = await body(
			chunked(['abc', new Error('request body size exceeded BODY_SIZE_LIMIT of 5242880')]),
			100
		);
		expect((result as Response).status).toBe(413);
	});

	it('turns an interrupted connection into a 400', async () => {
		const result = await body(chunked(['abc', new Error('aborted')]), 100);
		expect((result as Response).status).toBe(400);
		expect(await (result as Response).json()).toMatchObject({ error: { code: 'bad_request' } });
	});

	it('echoes the request id on the error', async () => {
		const result = (await body(chunked(['a'.repeat(50)]), 10)) as Response;
		expect(result.headers.get('x-request-id')).toBe('req-1');
	});
});
