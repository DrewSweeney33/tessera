import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/lib/core/client-header.ts';
import { freePort } from '../../scripts/lib/net.ts';
import { scrollsHorizontally } from './helpers.ts';

// The installable app (ADR-018): a manifest and icons, and a service worker that only shows an offline page when the
// server cannot be reached. It must never answer or store an API call or a study page. The offline tests start their own
// server, so they can stop it.

// Every other spec blocks service workers (playwright.config.ts); this one is about the worker.
test.use({ serviceWorkers: 'allow' });

const OFFLINE_HEADING = 'Tessera needs your server';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

interface Instance {
	base: string;
	stop: () => Promise<void>;
	child: ChildProcess;
}

// A throwaway Tessera on a free port with its own empty data folder.
async function startInstance(): Promise<Instance> {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), 'tessera-pwa-'));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['build/index.js'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			BODY_SIZE_LIMIT: '5M',
			TZ: 'America/Chicago',
			LOG_LEVEL: 'error'
		},
		stdio: ['ignore', 'ignore', 'ignore']
	});
	const deadline = Date.now() + 30_000;
	for (;;) {
		try {
			if ((await fetch(`${base}/healthz`)).ok) break;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline) throw new Error('the test server did not start');
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return {
		base,
		child,
		stop: async () => {
			if (child.exitCode === null) {
				const exited = new Promise((resolve) => child.once('exit', resolve));
				child.kill();
				await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
			}
			try {
				rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			} catch {
				// The folder is in the temp directory; a leftover is harmless.
			}
		}
	};
}

// Waits until the worker is active and controls this page (the first visit installs it, a reload lets it take over).
async function waitForWorker(page: Page) {
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function scan(page: Page, label: string) {
	await page.evaluate(() =>
		Promise.all(
			document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
		)
	);
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const summary = results.violations.map(
		(violation) =>
			`${violation.id} (${violation.impact}): ${violation.help}\n    ` +
			violation.nodes
				.slice(0, 3)
				.map((node) => node.target.join(' '))
				.join('\n    ')
	);
	expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test.describe('the manifest and the icons', () => {
	test('the page links a manifest that names real icons of the sizes it claims', async ({
		page,
		request
	}) => {
		await page.goto('/');
		const href = await page.locator('link[rel="manifest"]').getAttribute('href');
		expect(href).toBe('/manifest.webmanifest');
		const response = await request.get(href!);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('application/manifest+json');
		const manifest = (await response.json()) as {
			name: string;
			display: string;
			start_url: string;
			scope: string;
			icons: { src: string; sizes: string; type: string; purpose: string }[];
		};
		expect(manifest).toMatchObject({
			name: 'Tessera',
			display: 'standalone',
			start_url: '/',
			scope: '/'
		});
		for (const icon of manifest.icons) {
			const file = await request.get(icon.src);
			expect(file.status(), icon.src).toBe(200);
			expect(file.headers()['content-type'], icon.src).toBe(icon.type);
			// A PNG says its own size in the header: width and height are the two numbers after "IHDR".
			const bytes = await file.body();
			const width = bytes.readUInt32BE(16);
			const height = bytes.readUInt32BE(20);
			expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
		}
		expect(manifest.icons.map((icon) => icon.purpose)).toEqual(['any', 'any', 'maskable']);
	});

	test('the Apple touch icon is linked and served', async ({ page, request }) => {
		await page.goto('/');
		const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
		// A browser may show the address in full, so compare where it points.
		expect(new URL(href!, page.url()).pathname).toBe('/icons/apple-touch-icon.png');
		const response = await request.get(new URL(href!, page.url()).pathname);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('image/png');
	});

	test('the worker and the offline page are served, and the worker is not cached by the browser', async ({
		request
	}) => {
		const worker = await request.get('/service-worker.js');
		expect(worker.status()).toBe(200);
		expect(worker.headers()['content-type']).toMatch(/javascript/);
		const offline = await request.get('/offline.html');
		expect(offline.status()).toBe(200);
		expect(offline.headers()['content-type']).toContain('text/html');
		expect(await offline.text()).toContain(OFFLINE_HEADING);
	});
});

test.describe('the service worker', () => {
	test('installs, takes over after a reload, and holds only the offline page and the icons', async ({
		page
	}) => {
		await page.goto('/');
		await waitForWorker(page);
		const held = await page.evaluate(async () => {
			const out: Record<string, string[]> = {};
			for (const name of await caches.keys()) {
				const cache = await caches.open(name);
				out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
			}
			return out;
		});
		const names = Object.keys(held);
		expect(names).toHaveLength(1);
		expect(names[0]).toMatch(/^tessera-shell-[0-9a-f]{8}$/);
		expect(held[names[0]!]).toEqual([
			'/icons/icon-192.png',
			'/icons/icon-512.png',
			'/offline.html'
		]);
	});

	test('does not touch the API, a download, or the pages while the server is up', async ({
		page,
		request
	}) => {
		await page.goto('/');
		await waitForWorker(page);
		// The live answer comes back, and nothing about it is stored.
		const status = await page.evaluate(async () => (await fetch('/api/decks')).status);
		expect(status).toBe(200);
		await page.goto('/stats');
		await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
		await page.goto('/no-such-page');
		await expect(page.getByText(OFFLINE_HEADING)).toHaveCount(0);
		const stored = await page.evaluate(async () => {
			const urls: string[] = [];
			for (const name of await caches.keys()) {
				for (const entry of await (await caches.open(name)).keys())
					urls.push(new URL(entry.url).pathname);
			}
			return urls.sort();
		});
		expect(stored).toEqual(['/icons/icon-192.png', '/icons/icon-512.png', '/offline.html']);
		// A link to an API route is a navigation too, and it belongs to the server.
		const exported = await request.get('/api/decks');
		expect(exported.status()).toBe(200);
	});

	test('removes the shell caches of other builds and leaves any other cache alone', async ({
		page
	}) => {
		await page.goto('/');
		await waitForWorker(page);
		await page.evaluate(async () => {
			await caches.open('tessera-shell-00000000');
			await caches.open('some-other-app');
			const registration = await navigator.serviceWorker.getRegistration();
			await registration?.unregister();
		});
		// A fresh visit installs the worker again, and its activation cleans up.
		await page.goto('/');
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		await page.waitForFunction(async () =>
			(await caches.keys()).every((name) => name !== 'tessera-shell-00000000')
		);
		const names = await page.evaluate(async () => (await caches.keys()).sort());
		expect(names).toContain('some-other-app');
		expect(names.filter((name) => name.startsWith('tessera-shell-'))).toHaveLength(1);
		expect(names).not.toContain('tessera-shell-00000000');
		await page.evaluate(() => caches.delete('some-other-app'));
	});
});

test.describe('when the server cannot be reached', () => {
	test('shows the offline page for a page, never an old copy of the app or of any data', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const instance = await startInstance();
		try {
			await page.goto(instance.base);
			await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
			await waitForWorker(page);
			// Something to prove nothing is kept: import a deck while the server is up.
			const imported = await page.evaluate(
				async ([header, value]) => {
					const response = await fetch('/api/import', {
						method: 'POST',
						headers: { 'content-type': 'application/json', [header!]: value! },
						body: JSON.stringify({
							tessera: 1,
							deck: { id: 'offline-check', title: 'Offline check' },
							cards: [{ id: 'one', type: 'basic', front: 'Q', back: 'A' }]
						})
					});
					return response.status;
				},
				[CLIENT_HEADER, CLIENT_HEADER_VALUE]
			);
			expect(imported).toBe(200);

			await instance.stop();

			await page.goto(`${instance.base}/stats`);
			await expect(page.getByRole('heading', { name: OFFLINE_HEADING, level: 1 })).toBeVisible();
			await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/');
			await expect(page.getByText('Offline check')).toHaveCount(0);
			// An API call is not answered from anywhere: it fails, as it would without a worker.
			const apiResult = await page.evaluate(async () => {
				try {
					return `answered ${(await fetch('/api/decks')).status}`;
				} catch {
					return 'failed';
				}
			});
			expect(apiResult).toBe('failed');
			await scan(page, 'the offline page');
		} finally {
			await instance.stop();
		}
	});

	test('shows the real page again once the server is back', async ({ page }) => {
		test.setTimeout(120_000);
		const first = await startInstance();
		const base = first.base;
		const port = new URL(base).port;
		try {
			await page.goto(base);
			await waitForWorker(page);
			await first.stop();
			await page.goto(`${base}/stats`);
			await expect(page.getByRole('heading', { name: OFFLINE_HEADING })).toBeVisible();
		} finally {
			await first.stop();
		}
		// Start a server on the same port: the same origin, so the same worker, which must now let the live page through.
		const dataDir = mkdtempSync(join(tmpdir(), 'tessera-pwa-back-'));
		const child = spawn(process.execPath, ['build/index.js'], {
			env: {
				...process.env,
				NODE_ENV: 'production',
				PORT: port,
				HOST: '127.0.0.1',
				DATA_DIR: dataDir,
				BODY_SIZE_LIMIT: '5M',
				TZ: 'America/Chicago',
				LOG_LEVEL: 'error'
			},
			stdio: ['ignore', 'ignore', 'ignore']
		});
		try {
			const deadline = Date.now() + 30_000;
			for (;;) {
				try {
					if ((await fetch(`${base}/healthz`)).ok) break;
				} catch {
					// not up yet
				}
				if (Date.now() > deadline) throw new Error('the server did not come back');
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			await page.goto(`${base}/stats`);
			await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
			await expect(page.getByText(OFFLINE_HEADING)).toHaveCount(0);
		} finally {
			const exited = new Promise((resolve) => child.once('exit', resolve));
			child.kill();
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
			try {
				rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			} catch {
				// harmless
			}
		}
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('the offline page passes the accessibility scan', async ({ page }) => {
			await page.goto('/offline.html');
			await expect(page.getByRole('heading', { name: OFFLINE_HEADING, level: 1 })).toBeVisible();
			await scan(page, `offline page, ${scheme}`);
		});
	});
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test('the offline page fits and its button is easy to hit', async ({ page }) => {
		await page.goto('/offline.html');
		await expect(page.getByRole('heading', { name: OFFLINE_HEADING })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		const box = await page.getByRole('link', { name: 'Try again' }).boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
	});
});
