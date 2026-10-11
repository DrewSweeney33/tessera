import type { Handle } from '@sveltejs/kit/hooks';
import { getApp } from '../app.ts';
import { bearerToken, isWebPageRequest, requiresToken, tokenMatches } from './auth.ts';
import { checkContentType } from './content-type.ts';
import { errorResponse } from './errors.ts';
import { withHeaders } from './headers.ts';
import { displayableHost, isHostAllowed } from './hosts.ts';
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

// ADR-005 section 1: refuses requests for a host name the server is not meant to answer to, which is how a
// hostile web page reaches a service on the visitor's own network (DNS rebinding). /healthz is exempt so a
// monitor or the Docker health check works whatever name it uses. It reveals nothing but the version.
export const hostGuard: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/healthz') return resolve(event);
	const app = getApp();
	if (isHostAllowed(event.url.host, app.config.allowedHosts)) return resolve(event);

	const shown = displayableHost(event.url.host);
	app.log.warn('request refused, host name not allowed', {
		requestId: event.locals.requestId,
		host: shown ?? '(not a valid host name)'
	});
	const fix = shown
		? ` If this is your own address, set TESSERA_ALLOWED_HOSTS to include ${shown.replace(/:\d+$/, '')} and restart. See docs/deploy.md.`
		: '';
	return errorResponse(
		'misdirected_request',
		`This server does not answer to the host name ${shown ? `"${shown}"` : 'in the request'}.${fix}`,
		undefined,
		event.locals.requestId
	);
};

// ADR-009 and ADR-011: with TESSERA_API_TOKEN set, the API needs the token unless the Tessera web page itself
// sent the request. The page is not protected by the token (see auth.ts). The token is never logged.
export const apiTokenGuard: Handle = async ({ event, resolve }) => {
	const app = getApp();
	const expected = app.config.apiToken;
	if (expected === undefined || !requiresToken(event.url.pathname)) return resolve(event);

	const headers = event.request.headers;
	if (tokenMatches(bearerToken(headers.get('authorization')), expected)) return resolve(event);
	if (isWebPageRequest(headers, event.url.host)) return resolve(event);

	app.log.warn('request refused, API token missing or wrong', {
		requestId: event.locals.requestId,
		method: event.request.method,
		path: event.url.pathname,
		sentToken: headers.has('authorization')
	});
	return withHeaders(
		errorResponse(
			'unauthorized',
			'This API needs a token. Send the header "Authorization: Bearer <your TESSERA_API_TOKEN>". The Tessera web page itself does not need one.',
			undefined,
			event.locals.requestId
		),
		{ 'www-authenticate': 'Bearer realm="tessera"' }
	);
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
