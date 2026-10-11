import type { Handle } from '@sveltejs/kit/hooks';
import { getApp } from '../app.ts';
import { checkContentType } from './content-type.ts';
import { withHeaders } from './headers.ts';
import { resolveRequestId } from './request-id.ts';

// The individual request hooks. hooks.server.ts composes them with sequence(), and tests call them
// directly because sequence() needs SvelteKit's request store, which only exists in a real server.

// Outermost: every response carries the request id, and every request is logged once.
export const requestLogging: Handle = async ({ event, resolve }) => {
	event.locals.requestId = resolveRequestId(event.request.headers.get('x-request-id'));
	const started = performance.now();
	const response = await resolve(event);

	const path = event.url.pathname;
	const quiet = path === '/healthz' || path.startsWith('/_app/');
	getApp().log[quiet ? 'debug' : 'info']('request', {
		requestId: event.locals.requestId,
		method: event.request.method,
		path,
		status: response.status,
		ms: Math.round(performance.now() - started)
	});
	return withHeaders(response, { 'x-request-id': event.locals.requestId });
};

// ADR-005. The Content-Security-Policy itself is set by SvelteKit from the csp option in vite.config.ts.
export const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const headers: Record<string, string> = {
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer'
	};
	if (event.url.pathname.startsWith('/api/') && !response.headers.has('cache-control')) {
		headers['cache-control'] = 'no-store';
	}
	return withHeaders(response, headers);
};

// Mutating API calls must send a JSON (or, for import, Markdown) content type. See ADR-005.
export const contentTypeGuard: Handle = async ({ event, resolve }) => {
	const blocked = checkContentType(
		event.request.method,
		event.url.pathname,
		event.request.headers.get('content-type'),
		event.locals.requestId
	);
	return blocked ?? resolve(event);
};
