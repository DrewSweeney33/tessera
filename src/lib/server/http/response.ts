// Small response helpers so API code does not depend on SvelteKit and stays testable.
export function jsonResponse(
	data: unknown,
	init: { status?: number; headers?: HeadersInit } = {}
): Response {
	const headers = new Headers(init.headers);
	if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
	return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}
