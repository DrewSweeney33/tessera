import { describe, expect, it } from 'vitest';
import { err, ok } from '#lib/core/result.ts';
import {
	AppError,
	STATUS_BY_CODE,
	errorResponse,
	toErrorResponse
} from '#lib/server/http/errors.ts';
import { systemClock } from '#lib/server/clock.ts';

describe('Result helpers', () => {
	it('wraps success and failure values', () => {
		expect(ok(5)).toEqual({ ok: true, value: 5 });
		expect(err('nope')).toEqual({ ok: false, error: 'nope' });
	});
});

describe('errorResponse', () => {
	it('uses the standard JSON shape and the mapped status', async () => {
		const response = errorResponse('validation_failed', 'Deck is invalid', [{ path: 'cards[0]' }]);
		expect(response.status).toBe(422);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({
			error: {
				code: 'validation_failed',
				message: 'Deck is invalid',
				details: [{ path: 'cards[0]' }]
			}
		});
	});

	it('omits details when there are none and echoes the request id', async () => {
		const response = errorResponse('not_found', 'No such deck', undefined, 'req-1');
		expect(response.headers.get('x-request-id')).toBe('req-1');
		expect(await response.json()).toEqual({
			error: { code: 'not_found', message: 'No such deck' }
		});
	});

	it('maps every code to an HTTP error status', () => {
		for (const status of Object.values(STATUS_BY_CODE)) {
			expect(status).toBeGreaterThanOrEqual(400);
		}
		expect(STATUS_BY_CODE.stale_review).toBe(409);
		expect(STATUS_BY_CODE.unsupported_media_type).toBe(415);
		expect(STATUS_BY_CODE.payload_too_large).toBe(413);
		expect(STATUS_BY_CODE.misdirected_request).toBe(421);
		// The request is fine but the state of the data does not allow it (an id already taken, nothing to export).
		expect(STATUS_BY_CODE.conflict).toBe(409);
	});
});

describe('toErrorResponse', () => {
	it('keeps the code of an AppError', async () => {
		const response = toErrorResponse(new AppError('stale_review', 'Reviewed elsewhere'), 'r2');
		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('stale_review');
	});

	it('hides internals of unexpected errors', async () => {
		const response = toErrorResponse(new Error('SQLITE_CORRUPT at /data/tessera.db'));
		expect(response.status).toBe(500);
		const text = JSON.stringify(await response.json());
		expect(text).toContain('internal_error');
		expect(text).not.toContain('SQLITE');
		expect(text).not.toContain('/data');
	});
});

// Found by the live-image harness on the homelab: with the data volume full, an import answered "Something
// went wrong on the server" (a generic 500), so nobody could tell the disk was full. The database error is
// recognised, even when a layer above wraps it, and answered plainly, without internals.
describe('toErrorResponse for a full or unwritable disk', () => {
	const sqlite = (code: string) =>
		Object.assign(new Error(`${code}: database or disk is full`), { code });

	it('answers a full disk with 507 and says what to do', async () => {
		const response = toErrorResponse(sqlite('SQLITE_FULL'), 'r3');
		expect(response.status).toBe(507);
		expect(response.headers.get('x-request-id')).toBe('r3');
		const body = await response.json();
		expect(body.error.code).toBe('storage_full');
		expect(body.error.message).toMatch(/full/i);
		expect(body.error.message).toMatch(/free (up )?(some )?space/i);
		expect(body.error.message).toMatch(/history is (safe|intact|not lost)/i);
	});

	it('recognises the error when another layer wraps it, however deep', async () => {
		const wrapped = Object.assign(new Error('Failed query: insert into cards ...'), {
			cause: Object.assign(new Error('wrapper'), { cause: sqlite('SQLITE_FULL') })
		});
		expect(toErrorResponse(wrapped).status).toBe(507);
	});

	it('recognises the operating system error for no space left', async () => {
		expect(
			toErrorResponse(Object.assign(new Error('write failed'), { code: 'ENOSPC' })).status
		).toBe(507);
	});

	it('answers an unwritable database with 503 and a plain message', async () => {
		for (const code of [
			'SQLITE_READONLY',
			'SQLITE_READONLY_DBMOVED',
			'SQLITE_IOERR_WRITE',
			'SQLITE_IOERR'
		]) {
			const response = toErrorResponse(sqlite(code));
			expect(response.status, code).toBe(503);
			const body = await response.json();
			expect(body.error.code, code).toBe('service_unavailable');
			expect(body.error.message, code).toMatch(/cannot write|can't write|not writable/i);
		}
	});

	it('never leaks the database error, a path, or a query', async () => {
		const text = JSON.stringify(
			await toErrorResponse(
				Object.assign(new Error('SQLITE_FULL at /data/tessera.db: insert into cards (...)'), {
					code: 'SQLITE_FULL'
				})
			).json()
		);
		for (const secret of ['SQLITE', '/data', 'insert into', 'tessera.db']) {
			expect(text).not.toContain(secret);
		}
	});

	it('leaves other database errors as the generic 500', async () => {
		for (const code of ['SQLITE_CORRUPT', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_BUSY', 'EACCES']) {
			expect(toErrorResponse(sqlite(code)).status, code).toBe(500);
		}
	});

	it('copes with an error that points to itself, and with non-errors', () => {
		const loop: { cause?: unknown } = new Error('loop');
		loop.cause = loop;
		expect(toErrorResponse(loop).status).toBe(500);
		for (const odd of [null, undefined, 'a string', 42, { code: 7 }]) {
			expect(toErrorResponse(odd).status).toBe(500);
		}
	});

	it('has an HTTP status for the new code', () => {
		expect(STATUS_BY_CODE.storage_full).toBe(507);
	});
});

describe('systemClock', () => {
	it('returns a fresh Date each call', () => {
		const first = systemClock.now();
		expect(first).toBeInstanceOf(Date);
		expect(systemClock.now()).not.toBe(first);
	});
});
