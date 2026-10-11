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

describe('systemClock', () => {
	it('returns a fresh Date each call', () => {
		const first = systemClock.now();
		expect(first).toBeInstanceOf(Date);
		expect(systemClock.now()).not.toBe(first);
	});
});
