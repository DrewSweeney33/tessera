import type { AppContext } from '../app.ts';
import { getSessionEpoch } from '../repos/settings.ts';
import { SESSION_COOKIE, cookieValue, readSessionValue, type Session } from './session.ts';

// Reading a login off a request. Not exported from index.ts: it reaches the database, the rest of the folder does not.

export function nowSeconds(app: AppContext): number {
	return Math.floor(app.clock.now().getTime() / 1000);
}

// The session this request carries, or undefined when sign-in is off, there is no cookie, or the cookie is not valid
// (forged, from another password, or from before a Sign out everywhere).
export function sessionOf(app: AppContext, headers: Headers): Session | undefined {
	const auth = app.auth;
	if (!auth) return undefined;
	const value = cookieValue(headers.get('cookie'), SESSION_COOKIE);
	if (value === undefined) return undefined;
	return readSessionValue(auth.key, value, getSessionEpoch(app.db), nowSeconds(app));
}

// Whether the browser reached Tessera over HTTPS, which decides whether the cookie is marked Secure. The server cannot
// tell from its own address (behind a proxy it sees plain HTTP, and adapter-node assumes a scheme, see ADR-006), so it
// believes what the proxy says or what the browser says about itself. A cookie marked Secure on a plain-HTTP address
// would be dropped and sign-in would silently not stick, so when neither says HTTPS the cookie is not marked.
export function isHttps(headers: Headers): boolean {
	const forwarded = headers.get('x-forwarded-proto');
	if (forwarded !== null && forwarded.split(',')[0]!.trim().toLowerCase() === 'https') return true;
	const origin = headers.get('origin');
	return origin !== null && origin.toLowerCase().startsWith('https://');
}
