import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

// The login cookie (ADR-021). Its value is `v1.<epoch>.<issued>.<mac>`: a version, the counter that Sign out
// everywhere raises, when it was made (seconds), and an HMAC-SHA256 over those three with a key derived from the
// password. So it needs no session table, it survives a restart, it cannot be made without the password, and changing
// the password (which changes the key) ends every login. Nothing in it is secret except what the mac proves.

export const SESSION_COOKIE = 'tessera_session';
// The longest a browser keeps a cookie. A device that is used stays signed in because the cookie is renewed.
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const SESSION_RENEW_AFTER_SECONDS = 30 * 24 * 60 * 60;
// A cookie made a little in the future (a clock that stepped) is fine, a cookie from far ahead is not.
const FUTURE_SLACK_SECONDS = 600;

const VERSION = 'v1';
const KEY_CONTEXT = 'tessera-session-key-v1';
const MAX_VALUE_LENGTH = 200;
const PATTERN = /^v1\.([0-9]{1,9})\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;

// The key that signs cookies, from the password. scrypt, so a stolen cookie cannot be turned back into the password
// cheaply. A fixed context string, not a random salt, so the same password gives the same key after a restart.
export function deriveSessionKey(password: string): Buffer {
	return scryptSync(password, KEY_CONTEXT, 32);
}

function macOf(key: Buffer, epoch: number, issuedAtSeconds: number): Buffer {
	return createHmac('sha256', key).update(`${VERSION}.${epoch}.${issuedAtSeconds}`).digest();
}

export function makeSessionValue(key: Buffer, epoch: number, issuedAtSeconds: number): string {
	const mac = macOf(key, epoch, issuedAtSeconds).toString('base64url');
	return `${VERSION}.${epoch}.${issuedAtSeconds}.${mac}`;
}

export interface Session {
	// When the cookie was made, in seconds. The renewal rule reads it.
	issuedAtSeconds: number;
}

// The session a cookie value stands for, or undefined. The mac is compared in constant time. A value that is too long,
// the wrong shape, from another version, from another epoch, from the future, or signed with another key is refused.
export function readSessionValue(
	key: Buffer,
	value: string | undefined,
	currentEpoch: number,
	nowSeconds: number
): Session | undefined {
	if (value === undefined || value.length === 0 || value.length > MAX_VALUE_LENGTH)
		return undefined;
	const found = PATTERN.exec(value);
	if (!found) return undefined;
	const epoch = Number(found[1]);
	const issued = Number(found[2]);
	const given = Buffer.from(found[3]!, 'base64url');
	const expected = macOf(key, epoch, issued);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
	if (epoch !== currentEpoch) return undefined;
	if (issued > nowSeconds + FUTURE_SLACK_SECONDS) return undefined;
	return { issuedAtSeconds: issued };
}

// True when an active device should get a fresh cookie, so it never drops out while it is being used.
export function needsRenewal(session: Session, nowSeconds: number): boolean {
	return nowSeconds - session.issuedAtSeconds > SESSION_RENEW_AFTER_SECONDS;
}

// The value of one cookie from a Cookie header. The first one with that name wins. Never throws.
export function cookieValue(header: string | null, name: string): string | undefined {
	if (header === null || header.length > 8192) return undefined;
	for (const part of header.split(';')) {
		const at = part.indexOf('=');
		if (at < 0) continue;
		if (part.slice(0, at).trim() !== name) continue;
		return part.slice(at + 1).trim();
	}
	return undefined;
}

// The Set-Cookie header that signs a device in. HttpOnly (no script can read it), SameSite=Lax (not sent with a
// request another site starts, except a plain link to this site), and Secure when the page is served over HTTPS.
export function sessionCookieHeader(value: string, secure: boolean): string {
	return `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearCookieHeader(secure: boolean): string {
	return `${SESSION_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
