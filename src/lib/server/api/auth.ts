import { z } from 'zod';
import type { AuthStatusResponse } from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import { clearCookieHeader, makeSessionValue, sessionCookieHeader } from '../auth/index.ts';
import { isHttps, nowSeconds, sessionOf } from '../auth/request.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import { bumpSessionEpoch, getSessionEpoch } from '../repos/settings.ts';

// Sign-in over HTTP (ADR-021). Four routes: whether sign-in is on and the caller is in, sign in, sign out on this device,
// and sign out on every device. None of them ever returns, logs, or puts in a URL the password or the cookie.

// A password longer than the setting allows is simply wrong, so the length is not checked here: nothing about the
// password's form is revealed to someone guessing.
const LoginBody = z.object({ password: z.string() }).strict();
const LOGIN_BODY_BYTES = 1024;

const off = (requestId: string) =>
	errorResponse('not_found', 'Sign-in is not turned on.', undefined, requestId);

// GET /api/auth/status
export function handleAuthStatus(app: AppContext, request: Request): Response {
	const body: AuthStatusResponse = {
		enabled: app.auth !== undefined,
		signedIn: sessionOf(app, request.headers) !== undefined
	};
	return jsonResponse(body);
}

// POST /api/auth/login with {"password": "..."}. A wrong password is slowed down, never locked out (see throttle.ts).
export async function handleLogin(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const auth = app.auth;
	if (!auth) return off(requestId);

	const text = await readBodyText(
		request,
		LOGIN_BODY_BYTES,
		'The request body is too large.',
		requestId
	);
	if (text instanceof Response) return text;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return errorResponse('bad_request', 'The body must be valid JSON.', undefined, requestId);
	}
	const parsed = LoginBody.safeParse(value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'Send the password as {"password": "..."}.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}

	const place = auth.throttle.enter();
	if (!place) {
		app.log.warn('sign-in attempts are piling up, one was turned away', { requestId });
		const refused = errorResponse(
			'too_many_requests',
			'Too many sign-in attempts are waiting. Wait a little and try again.',
			undefined,
			requestId
		);
		refused.headers.set('retry-after', '30');
		return refused;
	}
	let right: boolean;
	try {
		if (place.delayMs > 0) await auth.sleep(place.delayMs);
		right = await auth.checker.verify(parsed.data.password);
	} finally {
		auth.throttle.leave();
	}

	if (!right) {
		auth.throttle.recordFailure();
		app.log.warn('sign-in failed', {
			requestId,
			recentFailures: auth.throttle.recentFailures()
		});
		return errorResponse('invalid_password', 'That password is not right.', undefined, requestId);
	}

	auth.throttle.recordSuccess();
	app.log.info('signed in', { requestId });
	const cookie = sessionCookieHeader(
		makeSessionValue(auth.key, getSessionEpoch(app.db), nowSeconds(app)),
		isHttps(request.headers)
	);
	return jsonResponse({ enabled: true, signedIn: true }, { headers: { 'set-cookie': cookie } });
}

// POST /api/auth/logout: ends the login on this device. A copy of the cookie kept elsewhere keeps working until Sign out
// everywhere or a password change (ADR-021). It does nothing, and says so, when nobody is signed in.
export function handleLogout(app: AppContext, request: Request): Response {
	const headers = { 'set-cookie': clearCookieHeader(isHttps(request.headers)) };
	return jsonResponse({ enabled: app.auth !== undefined, signedIn: false }, { headers });
}

// POST /api/auth/logout-all: raises the counter, so every cookie made before is refused, on this device and every other.
// It needs a login cookie, not just the API token: it is a decision for the person at the page.
export function handleLogoutAll(app: AppContext, request: Request, requestId: string): Response {
	if (!app.auth) return off(requestId);
	if (!sessionOf(app, request.headers)) {
		return errorResponse(
			'unauthorized',
			'Sign in first. Signing out everywhere needs a signed-in browser.',
			{ reason: 'sign_in_required' },
			requestId
		);
	}
	const epoch = bumpSessionEpoch(app.db);
	app.log.info('signed out everywhere', { requestId, epoch });
	const headers = { 'set-cookie': clearCookieHeader(isHttps(request.headers)) };
	return jsonResponse({ enabled: true, signedIn: false }, { headers });
}
