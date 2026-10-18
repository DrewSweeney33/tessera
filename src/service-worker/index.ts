import { immutable } from '$app/manifest';
import { self as worker } from '$app/service-worker';
import {
	NAVIGATION_TIMEOUT_MS,
	OFFLINE_URL,
	SHELL_FILES,
	buildId,
	cachesToDelete,
	raceWithTimeout,
	shellCacheName,
	shouldHandle
} from '#lib/core/service-worker.ts';

// The service worker (ADR-018). It does one thing: when a page cannot be reached because the server is down or the
// device is offline, it shows a plain offline page. It never answers an API call, an asset, or a download, never
// stores a page or any study data, and never changes a response from the server. The rules are in core/service-worker.ts.

// The files Vite made are named by a hash of their content, so their names change whenever the app does: a build's
// identity is a short hash of those names.
const CACHE = shellCacheName(buildId(immutable.map((file) => file.path)));

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([...SHELL_FILES]);
			await worker.skipWaiting();
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const name of cachesToDelete(await caches.keys(), CACHE)) await caches.delete(name);
			await worker.clients.claim();
		})()
	);
});

worker.addEventListener('fetch', (event) => {
	// Anything that is not a page navigation to this origin is left to the browser: no respondWith.
	if (!shouldHandle(event.request, worker.location.origin)) return;
	event.respondWith(answer(event.request));
});

// The server's own answer, whatever its status. Only when the server cannot be reached is the offline page shown.
async function answer(request: Request): Promise<Response> {
	try {
		return await raceWithTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
	} catch {
		const cached = await (await caches.open(CACHE)).match(OFFLINE_URL);
		return cached ?? Response.error();
	}
}
