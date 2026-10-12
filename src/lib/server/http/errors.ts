// One error shape for every API route (staff-engineer API conventions):
// { "error": { "code": "...", "message": "...", "details": ... } }
export type ApiErrorCode =
	| 'bad_request'
	| 'validation_failed'
	| 'unauthorized'
	| 'not_found'
	| 'stale_review'
	| 'payload_too_large'
	| 'unsupported_media_type'
	| 'misdirected_request'
	| 'service_unavailable'
	| 'storage_full'
	| 'internal_error';

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
	bad_request: 400,
	unauthorized: 401,
	not_found: 404,
	stale_review: 409,
	payload_too_large: 413,
	unsupported_media_type: 415,
	validation_failed: 422,
	misdirected_request: 421,
	service_unavailable: 503,
	storage_full: 507,
	internal_error: 500
};

export interface ApiErrorBody {
	error: { code: ApiErrorCode; message: string; details?: unknown };
}

export class AppError extends Error {
	readonly code: ApiErrorCode;
	readonly details: unknown;

	constructor(code: ApiErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.details = details;
	}
}

export function errorResponse(
	code: ApiErrorCode,
	message: string,
	details?: unknown,
	requestId?: string
): Response {
	const body: ApiErrorBody = {
		error: { code, message, ...(details === undefined ? {} : { details }) }
	};
	const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
	if (requestId) headers.set('x-request-id', requestId);
	return new Response(JSON.stringify(body), { status: STATUS_BY_CODE[code], headers });
}

// The first database or operating system error code in an error and the errors it wraps (a layer above the
// database may wrap the original). Bounded, so an error that points back at itself cannot loop.
function storageFailure(error: unknown): 'full' | 'unwritable' | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 6 && typeof current === 'object' && current !== null; depth++) {
		const code = (current as { code?: unknown }).code;
		if (code === 'SQLITE_FULL' || code === 'ENOSPC') return 'full';
		if (typeof code === 'string' && /^SQLITE_(READONLY|IOERR)/.test(code)) return 'unwritable';
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

// Expected failures keep their code. A full or unwritable data disk is named, with what to do, because the
// person running Tessera can fix it. Anything else is a bug: report a generic 500 and never leak internals.
export function toErrorResponse(error: unknown, requestId?: string): Response {
	if (error instanceof AppError) {
		return errorResponse(error.code, error.message, error.details, requestId);
	}
	const storage = storageFailure(error);
	if (storage === 'full') {
		return errorResponse(
			'storage_full',
			'The disk that holds the Tessera data is full, so this could not be saved. Free up some space and try again. Your study history is safe.',
			undefined,
			requestId
		);
	}
	if (storage === 'unwritable') {
		return errorResponse(
			'service_unavailable',
			'Tessera cannot write to its data folder right now. Check that the disk is not full or read-only, then try again. Your study history is safe.',
			undefined,
			requestId
		);
	}
	return errorResponse(
		'internal_error',
		'Something went wrong on the server.',
		undefined,
		requestId
	);
}
