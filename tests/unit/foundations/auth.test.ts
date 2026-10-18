import { describe, expect, it } from 'vitest';
import {
	FAILURE_WINDOW_MS,
	LoginThrottle,
	MAX_DELAY_MS,
	MAX_WAITING,
	SESSION_COOKIE,
	SESSION_RENEW_AFTER_SECONDS,
	clearCookieHeader,
	cookieValue,
	createPasswordChecker,
	deriveSessionKey,
	failureDelayMs,
	makeSessionValue,
	needsRenewal,
	readSessionValue,
	safeNextPath,
	sessionCookieHeader
} from '#lib/server/auth/index.ts';

const NOW = 1_800_000_000;
const key = deriveSessionKey('a long enough password');

describe('session cookie', () => {
	it('round-trips', () => {
		const value = makeSessionValue(key, 3, NOW);
		expect(readSessionValue(key, value, 3, NOW + 60)).toEqual({ issuedAtSeconds: NOW });
	});

	it('is stable: the same password gives the same key and the same value', () => {
		expect(deriveSessionKey('a long enough password').equals(key)).toBe(true);
		expect(makeSessionValue(key, 0, NOW)).toBe(makeSessionValue(key, 0, NOW));
	});

	it('refuses a value signed with another password', () => {
		const other = deriveSessionKey('another long password');
		expect(readSessionValue(key, makeSessionValue(other, 0, NOW), 0, NOW)).toBeUndefined();
	});

	it('refuses another epoch, older or newer', () => {
		const value = makeSessionValue(key, 2, NOW);
		expect(readSessionValue(key, value, 3, NOW)).toBeUndefined();
		expect(readSessionValue(key, value, 1, NOW)).toBeUndefined();
	});

	it('refuses a tampered counter, time, or mac', () => {
		const [version, epoch, issued, mac] = makeSessionValue(key, 1, NOW).split('.') as [
			string,
			string,
			string,
			string
		];
		expect(readSessionValue(key, `${version}.2.${issued}.${mac}`, 2, NOW)).toBeUndefined();
		expect(
			readSessionValue(key, `${version}.${epoch}.${Number(issued) + 1}.${mac}`, 1, NOW + 5)
		).toBeUndefined();
		const flipped = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
		expect(
			readSessionValue(key, `${version}.${epoch}.${issued}.${flipped}`, 1, NOW)
		).toBeUndefined();
	});

	it('refuses anything that is not a well-formed value', () => {
		const good = makeSessionValue(key, 0, NOW);
		const bad: (string | undefined)[] = [
			undefined,
			'',
			'v1',
			'v1.0.1',
			good.slice(0, -1),
			good + 'A',
			good.replace('v1.', 'v2.'),
			good.replace(/\./g, ','),
			`${good}.extra`,
			' ' + good,
			'v1.-1.1.' + 'A'.repeat(43),
			'v1.0.1.' + 'A'.repeat(43),
			'v1.9999999999.1.' + 'A'.repeat(43),
			'x'.repeat(5000)
		];
		for (const value of bad) expect(readSessionValue(key, value, 0, NOW)).toBeUndefined();
	});

	it('refuses a value made far in the future, allows a few minutes of clock difference', () => {
		expect(readSessionValue(key, makeSessionValue(key, 0, NOW + 300), 0, NOW)).toBeDefined();
		expect(readSessionValue(key, makeSessionValue(key, 0, NOW + 3600), 0, NOW)).toBeUndefined();
	});

	it('renews after 30 days and not before', () => {
		expect(needsRenewal({ issuedAtSeconds: NOW }, NOW + SESSION_RENEW_AFTER_SECONDS)).toBe(false);
		expect(needsRenewal({ issuedAtSeconds: NOW }, NOW + SESSION_RENEW_AFTER_SECONDS + 1)).toBe(
			true
		);
	});
});

describe('cookie header', () => {
	it('finds one cookie among others and ignores the rest', () => {
		expect(cookieValue(`a=1; ${SESSION_COOKIE}=abc; b=2`, SESSION_COOKIE)).toBe('abc');
		expect(cookieValue('a=1; b=2', SESSION_COOKIE)).toBeUndefined();
		expect(cookieValue(null, SESSION_COOKIE)).toBeUndefined();
		expect(cookieValue('x'.repeat(9000), SESSION_COOKIE)).toBeUndefined();
		expect(cookieValue(`x${SESSION_COOKIE}=abc`, SESSION_COOKIE)).toBeUndefined();
		expect(cookieValue(`${SESSION_COOKIE}`, SESSION_COOKIE)).toBeUndefined();
	});

	it('takes the first one when the name is sent twice', () => {
		expect(cookieValue(`${SESSION_COOKIE}=one; ${SESSION_COOKIE}=two`, SESSION_COOKIE)).toBe('one');
	});

	it('sets HttpOnly, SameSite=Lax, a path, and Secure only over HTTPS', () => {
		const plain = sessionCookieHeader('v', false);
		expect(plain).toContain('HttpOnly');
		expect(plain).toContain('SameSite=Lax');
		expect(plain).toContain('Path=/');
		expect(plain).toContain('Max-Age=34560000');
		expect(plain).not.toContain('Secure');
		expect(sessionCookieHeader('v', true)).toContain('; Secure');
		expect(clearCookieHeader(false)).toContain('Max-Age=0');
		expect(clearCookieHeader(true)).toContain('; Secure');
	});
});

describe('password check', () => {
	it('accepts the password and refuses everything else', async () => {
		const checker = createPasswordChecker('a long enough password');
		expect(await checker.verify('a long enough password')).toBe(true);
		for (const wrong of [
			'',
			'a long enough passwor',
			'A long enough password',
			'a long enough password ',
			'x'.repeat(1000)
		]) {
			expect(await checker.verify(wrong)).toBe(false);
		}
	});
});

describe('wrong-guess delay', () => {
	it('is none for the first two, then 0.5 s doubling to 30 s', () => {
		expect([0, 1, 2].map(failureDelayMs)).toEqual([0, 0, 0]);
		expect([3, 4, 5, 6, 7, 8].map(failureDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 16000]);
		expect(failureDelayMs(9)).toBe(MAX_DELAY_MS);
		expect(failureDelayMs(500)).toBe(MAX_DELAY_MS);
	});

	it('counts wrong guesses in a 15 minute window and forgets older ones', () => {
		let now = 0;
		const throttle = new LoginThrottle(() => now);
		for (let i = 0; i < 3; i += 1) throttle.recordFailure();
		expect(throttle.recentFailures()).toBe(3);
		expect(throttle.enter()).toEqual({ delayMs: 500 });
		throttle.leave();
		now = FAILURE_WINDOW_MS + 1;
		expect(throttle.recentFailures()).toBe(0);
		expect(throttle.enter()).toEqual({ delayMs: 0 });
	});

	it('counts attempts that are already waiting, so guessing in parallel gains nothing', () => {
		const throttle = new LoginThrottle(() => 0);
		const delays: number[] = [];
		for (let i = 0; i < 6; i += 1) delays.push(throttle.enter()!.delayMs);
		expect(delays).toEqual([0, 0, 0, 500, 1000, 2000]);
	});

	it('turns away the twenty-first waiting attempt and lets one in when another leaves', () => {
		const throttle = new LoginThrottle(() => 0);
		for (let i = 0; i < MAX_WAITING; i += 1) expect(throttle.enter()).toBeDefined();
		expect(throttle.enter()).toBeUndefined();
		throttle.leave();
		expect(throttle.enter()).toBeDefined();
	});

	it('clears the count on success and never goes below zero waiting', () => {
		const throttle = new LoginThrottle(() => 0);
		for (let i = 0; i < 5; i += 1) throttle.recordFailure();
		throttle.recordSuccess();
		expect(throttle.recentFailures()).toBe(0);
		throttle.leave();
		throttle.leave();
		expect(throttle.enter()).toEqual({ delayMs: 0 });
	});
});

describe('safeNextPath', () => {
	it('keeps a plain path on this site, with its query and fragment', () => {
		expect(safeNextPath('/settings')).toBe('/settings');
		expect(safeNextPath('/decks/abc?tab=cards#top')).toBe('/decks/abc?tab=cards#top');
		expect(safeNextPath('/')).toBe('/');
	});

	it('sends everything else to the start page', () => {
		const bad: (string | null | undefined)[] = [
			undefined,
			null,
			'',
			'settings',
			'//evil.example',
			'//evil.example/path',
			'/\\evil.example',
			'\\\\evil.example',
			'https://evil.example',
			'javascript:alert(1)',
			'/ok\r\nSet-Cookie: a=b',
			'/ok\u0000',
			'/login',
			'/login?next=/settings',
			'/Login/',
			'/api/decks',
			'/API',
			'/' + 'a'.repeat(600)
		];
		for (const value of bad) expect(safeNextPath(value)).toBe('/');
	});

	it('does not treat a path that only starts with the same letters as the login or the API', () => {
		expect(safeNextPath('/loginhelp')).toBe('/loginhelp');
		expect(safeNextPath('/apiary')).toBe('/apiary');
	});
});
