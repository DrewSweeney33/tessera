import { createHash, timingSafeEqual } from 'node:crypto';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '#lib/core/client-header.ts';

// The API token (ADR-009, ADR-011). When TESSERA_API_TOKEN is set, a request to the API needs the token,
// unless it comes from the Tessera web page itself. This protects against scripts that do not pretend to be
// the web page, and against other websites reaching the API through a visitor's browser. It does not
// protect the web page, and so it does not stop someone who can open the page and who copies what it sends.
// That is for a reverse proxy or a VPN. The deployment guide says so.

// Routes that never need the token. /healthz is not under /api, so it is not listed.
const OPEN_API_PATHS = new Set(['/api/schema']);

// The path as the router sees it. SvelteKit decodes it before matching, so "/%61pi/decks" reaches
// "/api/decks". Checking the raw path would let that variant past the guard.
export function routingPath(pathname: string): string {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		// The router refuses a path that does not decode. If that ever changes, requiring the token is safe.
		return '/api/';
	}
}

export function requiresToken(pathname: string): boolean {
	const path = routingPath(pathname);
	if (OPEN_API_PATHS.has(path)) return false;
	return path === '/api' || path.startsWith('/api/');
}

// "Authorization: Bearer <token>". The scheme name is not case sensitive. Anything else gives undefined.
export function bearerToken(header: string | null): string | undefined {
	if (header === null) return undefined;
	const found = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
	return found?.[1];
}

// Compared as digests of equal length, in constant time, so the time taken does not reveal how much of a
// guess was right.
export function tokenMatches(presented: string | undefined, expected: string): boolean {
	if (presented === undefined) return false;
	const a = createHash('sha256').update(presented, 'utf8').digest();
	const b = createHash('sha256').update(expected, 'utf8').digest();
	return timingSafeEqual(a, b);
}

// True for a request that the Tessera web page itself sent. In order:
//   1. Sec-Fetch-Site, which the browser sets and a page cannot change, is the word of the browser. Only
//      "same-origin" counts. "same-site" (another port on this host), "cross-site", and "none" (someone typed
//      the address) do not, even if the headers below look right.
//   2. Without it, the Origin header must name this server's own host and port (the Host header). A browser
//      sends Origin on every cross-origin request and on same-origin requests other than GET. The scheme is
//      not compared: behind adapter-node the server believes it is https unless told otherwise, so the scheme
//      it sees is not the one the browser used, and the server only speaks one scheme anyway.
//   3. Without either (plain HTTP on an address that is not localhost, where browsers send no Sec-Fetch-*,
//      and a same-origin GET, which carries no Origin), the page's own marker header. A page on another site
//      cannot send it (see client-header.ts).
// A script can send any of these, so none of this is a login. See the note at the top.
// The host and port of an Origin header, or undefined if it is not a plain http or https origin
// ("null" from a sandboxed page, a path, a trailing slash, credentials).
function originHost(origin: string): string | undefined {
	try {
		const url = new URL(origin);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		return url.origin === origin ? url.host : undefined;
	} catch {
		return undefined;
	}
}

export function isWebPageRequest(headers: Headers, serverHost: string): boolean {
	const site = headers.get('sec-fetch-site');
	if (site !== null) return site === 'same-origin';
	const origin = headers.get('origin');
	if (origin !== null) return originHost(origin) === serverHost.toLowerCase();
	return headers.get(CLIENT_HEADER) === CLIENT_HEADER_VALUE;
}
