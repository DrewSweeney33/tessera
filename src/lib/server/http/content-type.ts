import { errorResponse } from './errors.ts';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ADR-005: a cross-site page cannot send application/json without a CORS preflight, and no CORS
// headers are ever emitted. Requiring it on every mutating API call closes the "simple request" hole.
// The import route also accepts Markdown.
function acceptedTypes(pathname: string): readonly string[] | undefined {
	if (pathname === '/api/import') return ['application/json', 'text/markdown'];
	if (pathname.startsWith('/api/')) return ['application/json'];
	return undefined;
}

export function mediaType(header: string | null): string {
	return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

// Returns a 415 response when a mutating /api request has the wrong content type, otherwise undefined.
export function checkContentType(
	method: string,
	pathname: string,
	header: string | null,
	requestId: string
): Response | undefined {
	if (!MUTATING.has(method.toUpperCase())) return undefined;
	const accepted = acceptedTypes(pathname);
	if (!accepted) return undefined;
	const actual = mediaType(header);
	if (accepted.includes(actual)) return undefined;
	return errorResponse(
		'unsupported_media_type',
		`This endpoint needs Content-Type: ${accepted.join(' or ')}${actual ? `, but received ${actual}` : ', but none was sent'}.`,
		{ accepted },
		requestId
	);
}
