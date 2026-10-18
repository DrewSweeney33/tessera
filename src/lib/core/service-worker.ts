// The rules of the service worker (ADR-018), kept here so they can be tested without a browser. The worker only shows an
// offline page when the server cannot be reached. It never answers or stores anything else.

// Every cache the worker makes starts with this, so it only ever deletes its own.
export const SHELL_CACHE_PREFIX = 'tessera-shell-';

// The page shown when a navigation cannot reach the server, and the files kept next to it.
export const OFFLINE_URL = '/offline.html';
export const SHELL_FILES = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'] as const;

// A navigation that takes longer than this is treated as unreachable.
export const NAVIGATION_TIMEOUT_MS = 8000;

// A short identity for a build, from the names of the files it made (they carry a content hash, so any change to the
// app changes them). FNV-1a over the sorted names, in hex. Not a security measure, only a name that changes with the build.
export function buildId(paths: readonly string[]): string {
	let hash = 0x811c9dc5;
	for (const character of [...paths].sort().join('|')) {
		hash ^= character.codePointAt(0)!;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

// The cache for one build. A new build gets a new name, so the old shell is replaced, never reused.
export function shellCacheName(version: string): string {
	return `${SHELL_CACHE_PREFIX}${version}`;
}

// The caches to delete when a build takes over: the shell caches of other builds. A cache that is not ours is left alone.
export function cachesToDelete(names: readonly string[], current: string): string[] {
	return names.filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== current);
}

export interface WorkerRequest {
	mode: string;
	method: string;
	url: string;
}

// Whether the worker takes over a request. Only a page navigation (the browser opening a page) to this origin, never an
// API call, a download, an asset, or a write. When this is false the worker does not call `respondWith` at all, so the
// browser handles the request as if there were no worker.
export function shouldHandle(request: WorkerRequest, origin: string): boolean {
	if (request.mode !== 'navigate' || request.method !== 'GET') return false;
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	if (url.origin !== origin) return false;
	// A link to an API route (an export download, for example) is a navigation too. It belongs to the server.
	if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return false;
	return true;
}

// Waits for `work`, but gives up after `ms`. `schedule` is `setTimeout`, passed in so a test can control time. A late
// answer after giving up is ignored.
export function raceWithTimeout<T>(
	work: Promise<T>,
	ms: number,
	schedule: (callback: () => void, ms: number) => unknown = (callback, delay) =>
		setTimeout(callback, delay)
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		schedule(() => {
			if (settled) return;
			settled = true;
			reject(new Error('The server did not answer in time.'));
		}, ms);
		work.then(
			(value) => {
				if (settled) return;
				settled = true;
				resolve(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
}
