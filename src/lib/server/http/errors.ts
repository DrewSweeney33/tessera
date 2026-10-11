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

// Expected failures keep their code. Anything else is a bug: report a generic 500 and never leak internals.
export function toErrorResponse(error: unknown, requestId?: string): Response {
	if (error instanceof AppError) {
		return errorResponse(error.code, error.message, error.details, requestId);
	}
	return errorResponse(
		'internal_error',
		'Something went wrong on the server.',
		undefined,
		requestId
	);
}
