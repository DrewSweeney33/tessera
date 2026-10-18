import { describe, expect, it } from 'vitest';
import {
	NAVIGATION_TIMEOUT_MS,
	OFFLINE_URL,
	SHELL_CACHE_PREFIX,
	SHELL_FILES,
	buildId,
	cachesToDelete,
	raceWithTimeout,
	shellCacheName,
	shouldHandle
} from '#lib/core/service-worker.ts';

// The rules of the service worker (ADR-018): what it takes over, which caches it owns, and when it gives up waiting.

const ORIGIN = 'https://tessera.example';
const nav = (url: string, overrides: Partial<{ mode: string; method: string }> = {}) => ({
	mode: 'navigate',
	method: 'GET',
	url,
	...overrides
});

describe('shouldHandle', () => {
	it.each([
		`${ORIGIN}/`,
		`${ORIGIN}/study`,
		`${ORIGIN}/study/ccna-01`,
		`${ORIGIN}/stats?folder=3`,
		`${ORIGIN}/decks/new`,
		`${ORIGIN}/healthz`,
		`${ORIGIN}/apiary`,
		`${ORIGIN}/apis/x`
	])('takes over a page navigation to %s', (url) => {
		expect(shouldHandle(nav(url), ORIGIN)).toBe(true);
	});

	it.each([
		`${ORIGIN}/api`,
		`${ORIGIN}/api/`,
		`${ORIGIN}/api/decks`,
		`${ORIGIN}/api/decks/ccna-01/export?format=md`,
		`${ORIGIN}/api/backups/manual-x.db`,
		`${ORIGIN}/api/study/next`
	])('never takes over an API route, even as a navigation: %s', (url) => {
		expect(shouldHandle(nav(url), ORIGIN)).toBe(false);
	});

	it('leaves everything that is not a navigation to the browser', () => {
		for (const mode of ['cors', 'no-cors', 'same-origin', 'websocket']) {
			expect(shouldHandle(nav(`${ORIGIN}/`, { mode }), ORIGIN), mode).toBe(false);
		}
	});

	it('leaves every write to the browser', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
			expect(shouldHandle(nav(`${ORIGIN}/`, { method }), ORIGIN), method).toBe(false);
		}
	});

	it('leaves another origin to the browser', () => {
		for (const url of [
			'https://other.example/',
			'http://tessera.example/',
			'https://tessera.example:8443/',
			'https://tessera.example.evil.example/',
			'https://evil.example/?https://tessera.example/'
		]) {
			expect(shouldHandle(nav(url), ORIGIN), url).toBe(false);
		}
	});

	it('refuses a url it cannot read', () => {
		expect(shouldHandle(nav('not a url'), ORIGIN)).toBe(false);
		expect(shouldHandle(nav(''), ORIGIN)).toBe(false);
	});
});

describe('cache names', () => {
	it('puts the build in the name, under one prefix', () => {
		expect(SHELL_CACHE_PREFIX).toBe('tessera-shell-');
		expect(shellCacheName('1a2b3c4d')).toBe('tessera-shell-1a2b3c4d');
	});

	it('deletes the shell caches of other builds and nothing else', () => {
		const current = shellCacheName('new');
		expect(
			cachesToDelete(
				[
					'tessera-shell-old',
					'tessera-shell-older',
					current,
					'other-app-cache',
					'workbox-precache',
					'tessera',
					'tessera-shellfish',
					'TESSERA-SHELL-X'
				],
				current
			)
		).toEqual(['tessera-shell-old', 'tessera-shell-older']);
	});

	it('deletes nothing when the current cache is the only one', () => {
		const current = shellCacheName('only');
		expect(cachesToDelete([current], current)).toEqual([]);
		expect(cachesToDelete([], current)).toEqual([]);
	});
});

describe('buildId', () => {
	const files = [
		'/_app/immutable/chunks/a.1111.js',
		'/_app/immutable/entry/b.2222.js',
		'/_app/x.css'
	];

	it('is eight hex digits and the same for the same files in any order', () => {
		const id = buildId(files);
		expect(id).toMatch(/^[0-9a-f]{8}$/);
		expect(buildId([...files].reverse())).toBe(id);
		expect(buildId(files)).toBe(id);
	});

	it('changes when a file is renamed, added, or removed', () => {
		const id = buildId(files);
		expect(buildId(['/_app/immutable/chunks/a.9999.js', files[1]!, files[2]!])).not.toBe(id);
		expect(buildId([...files, '/_app/new.js'])).not.toBe(id);
		expect(buildId(files.slice(1))).not.toBe(id);
	});

	it('does not mix up names that run together', () => {
		expect(buildId(['ab', 'c'])).not.toBe(buildId(['a', 'bc']));
	});

	it('copes with no files', () => {
		expect(buildId([])).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe('what the shell holds', () => {
	it('is the offline page and the two icons, all on this origin and none of them an API route', () => {
		expect(SHELL_FILES).toEqual([OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png']);
		for (const file of SHELL_FILES) {
			expect(file.startsWith('/')).toBe(true);
			expect(file.startsWith('/api')).toBe(false);
		}
	});
});

describe('raceWithTimeout', () => {
	// A scheduler a test controls: the callback runs when `fire()` is called.
	function manualTimer() {
		let pending: (() => void) | undefined;
		let delay = -1;
		return {
			schedule: (callback: () => void, ms: number) => {
				pending = callback;
				delay = ms;
			},
			fire: () => pending?.(),
			get delay() {
				return delay;
			}
		};
	}

	it('gives the answer when it comes first', async () => {
		const timer = manualTimer();
		await expect(raceWithTimeout(Promise.resolve('page'), 8000, timer.schedule)).resolves.toBe(
			'page'
		);
		expect(timer.delay).toBe(8000);
	});

	it('gives up when the time runs out first, and ignores a late answer', async () => {
		const timer = manualTimer();
		let late: (value: string) => void = () => {};
		const slow = new Promise<string>((resolve) => (late = resolve));
		const raced = raceWithTimeout(slow, 8000, timer.schedule);
		timer.fire();
		await expect(raced).rejects.toThrow('did not answer in time');
		late('too late');
		await expect(raced).rejects.toThrow('did not answer in time');
	});

	it('passes a failure through, as an error', async () => {
		const timer = manualTimer();
		await expect(
			raceWithTimeout(Promise.reject(new TypeError('offline')), 100, timer.schedule)
		).rejects.toThrow('offline');
		await expect(
			raceWithTimeout(Promise.reject('plain text'), 100, timer.schedule)
		).rejects.toThrow('plain text');
	});

	it('does nothing when the timer fires after the answer', async () => {
		const timer = manualTimer();
		const raced = raceWithTimeout(Promise.resolve(1), 100, timer.schedule);
		await expect(raced).resolves.toBe(1);
		timer.fire();
		await expect(raced).resolves.toBe(1);
	});

	it('uses a real timer by default', async () => {
		await expect(raceWithTimeout(new Promise(() => {}), 5)).rejects.toThrow(
			'did not answer in time'
		);
	});

	it('waits 8 seconds before the worker gives up on a navigation', () => {
		expect(NAVIGATION_TIMEOUT_MS).toBe(8000);
	});
});
