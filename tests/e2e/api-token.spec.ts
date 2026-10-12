import { networkInterfaces } from 'node:os';
import { expect, test, type Page, type Request } from '@playwright/test';
import { basicCards, deckOf } from './helpers.ts';
import { tokenPort, tokenValue } from './token-server.ts';

// The API token (ADR-009, ADR-011), tested against a real server that has TESSERA_API_TOKEN set and listens on
// every address. The web page must keep working without the token, even over plain HTTP on the machine's
// network address, where browsers send no Sec-Fetch-Site. Other websites and plain scripts must not get in.

const LOOPBACK = `http://127.0.0.1:${tokenPort}`;
const lanAddress = Object.values(networkInterfaces())
	.flat()
	.find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
const bearer = { authorization: `Bearer ${tokenValue}` };

async function importAndStudy(page: Page, base: string, id: string) {
	await page.goto(`${base}/import`);
	await page
		.getByLabel('Deck (JSON or Markdown)')
		.fill(JSON.stringify(deckOf(id, `Token ${id}`, basicCards(2, 'tk'))));
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: /New deck/ })).toBeVisible();
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
	await page.getByRole('link', { name: 'Study this deck' }).click();
	await expect(page.locator('.card__front')).toContainText('Question');
	await page.keyboard.press('Space');
	await expect(page.locator('.card__back')).toContainText('Answer');
	await page.keyboard.press('4');
	await page.goto(`${base}/`);
	await expect(page.getByRole('heading', { name: `Token ${id}` })).toBeVisible();
}

test.describe('the web page with a token set', () => {
	test('imports and studies on a loopback address', async ({ page }) => {
		await importAndStudy(page, LOOPBACK, 'loopback');
	});

	test('imports and studies over plain HTTP on the machine network address', async ({ page }) => {
		test.skip(!lanAddress, 'this machine has no network address other than loopback');
		const base = `http://${lanAddress}:${tokenPort}`;
		// Only note the requests here. Reading a request's headers is asynchronous, and doing it inside the event
		// handler can still be pending when the test ends, which fails the test with "Test ended".
		const requests: Request[] = [];
		page.on('request', (request) => {
			if (request.url().startsWith(`${base}/api/`)) requests.push(request);
		});
		await importAndStudy(page, base, 'lan');
		const wire = await Promise.all(requests.map((request) => request.allHeaders()));

		// Every call from the page carries its marker, and none of them had Sec-Fetch-Site: a browser sends it
		// only to HTTPS and localhost, which is why the marker exists (ADR-011). This keeps that premise checked.
		expect(wire.length).toBeGreaterThan(3);
		for (const headers of wire) expect(headers['x-tessera-client']).toBe('web');
		expect(wire.filter((headers) => headers['sec-fetch-site'])).toEqual([]);
	});

	test('the token is not in the page or its scripts', async ({ request }) => {
		const html = await (await request.get(`${LOOPBACK}/`)).text();
		expect(html).not.toContain(tokenValue);
		const sources = [...new Set(html.match(/\/_app\/immutable\/[^"'\s)]+\.js/g) ?? [])];
		expect(sources.length).toBeGreaterThan(0);
		for (const source of sources) {
			const script = await (await request.get(`${LOOPBACK}${source}`)).text();
			expect(script, source).not.toContain(tokenValue);
		}
	});
});

test.describe('callers that are not the web page', () => {
	test('a plain request without the token is refused, with the right token it works', async ({
		request
	}) => {
		const without = await request.get(`${LOOPBACK}/api/decks`);
		expect(without.status()).toBe(401);
		expect(without.headers()['www-authenticate']).toContain('Bearer');
		expect((await without.json()).error.code).toBe('unauthorized');

		const wrong = await request.get(`${LOOPBACK}/api/decks`, {
			headers: { authorization: 'Bearer not-the-token-not-the-token' }
		});
		expect(wrong.status()).toBe(401);

		expect((await request.get(`${LOOPBACK}/api/decks`, { headers: bearer })).status()).toBe(200);
	});

	test('a script with the token can import a deck, in JSON and in Markdown', async ({
		request
	}) => {
		const json = await request.post(`${LOOPBACK}/api/import`, {
			headers: { ...bearer, 'content-type': 'application/json' },
			data: JSON.stringify(deckOf('script-json', 'Script JSON', basicCards(1, 'sj')))
		});
		expect(json.status()).toBe(200);
		const markdown = await request.post(`${LOOPBACK}/api/import`, {
			headers: { ...bearer, 'content-type': 'text/markdown' },
			data: '---\ntessera: 1\nid: script-md\ntitle: Script MD\n---\n\n## a\nQ: q\nA: a\n'
		});
		expect(markdown.status()).toBe(200);
		const refused = await request.post(`${LOOPBACK}/api/import`, {
			headers: { 'content-type': 'application/json' },
			data: JSON.stringify(deckOf('script-no', 'No token', basicCards(1)))
		});
		expect(refused.status()).toBe(401);
	});

	test('the health check and the schema stay open', async ({ request }) => {
		expect((await request.get(`${LOOPBACK}/healthz`)).status()).toBe(200);
		expect((await request.get(`${LOOPBACK}/api/schema`)).status()).toBe(200);
	});

	test('a path that the router decodes does not get around the token', async ({ request }) => {
		for (const path of ['/%61pi/decks', '/ap%69/decks', '/api/%64ecks']) {
			expect((await request.get(`${LOOPBACK}${path}`)).status(), path).toBe(401);
		}
	});
});

test.describe('a page on another website', () => {
	// The default test server is a different origin (another port), so a page from it stands in for a hostile
	// site that a visitor has open in another tab.

	test('is never told it may send the header that marks the Tessera page', async ({ request }) => {
		// A browser asks first before sending a custom header from another site. The answer must be no.
		const preflight = await request.fetch(`${LOOPBACK}/api/decks`, {
			method: 'OPTIONS',
			headers: {
				origin: 'http://127.0.0.1:4177',
				'access-control-request-method': 'GET',
				'access-control-request-headers': 'x-tessera-client'
			}
		});
		const headers = preflight.headers();
		expect(headers['access-control-allow-origin']).toBeUndefined();
		expect(headers['access-control-allow-headers']).toBeUndefined();
		expect(headers['access-control-allow-methods']).toBeUndefined();
	});

	test('cannot read the API, and a call that tries to carry the marker never goes out', async ({
		page
	}) => {
		await page.goto('/healthz');
		const answered: string[] = [];
		page.on('response', (response) => {
			if (response.url().startsWith(`${LOOPBACK}/api/`)) {
				answered.push(`${response.request().method()} ${response.status()}`);
			}
		});

		const withMarker = await page.evaluate(
			(url) =>
				fetch(url, { headers: { 'x-tessera-client': 'web' } }).then(
					() => 'sent',
					() => 'blocked'
				),
			`${LOOPBACK}/api/decks`
		);
		expect(withMarker).toBe('blocked');
		// The browser stopped at the preflight. No GET was ever answered.
		expect(answered.filter((entry) => entry.startsWith('GET'))).toEqual([]);

		const readable = await page.evaluate(
			(url) =>
				fetch(url, { mode: 'cors' }).then(
					() => 'readable',
					() => 'blocked'
				),
			`${LOOPBACK}/api/decks`
		);
		expect(readable).toBe('blocked');
	});

	test('a plain cross-site call is answered 401, not with the decks', async ({ page }) => {
		await page.goto('/healthz');
		const statuses: number[] = [];
		page.on('response', (response) => {
			if (response.url() === `${LOOPBACK}/api/decks`) statuses.push(response.status());
		});
		await page.evaluate(
			(url) => fetch(url, { mode: 'no-cors' }).then(() => undefined),
			`${LOOPBACK}/api/decks`
		);
		await expect.poll(() => statuses.length).toBeGreaterThan(0);
		expect(statuses).toEqual([401]);
	});

	test('cannot post a deck with a form, the one cross-site write that needs no permission', async ({
		page
	}) => {
		await page.goto('/healthz');
		const statuses: number[] = [];
		page.on('response', (response) => {
			if (response.url() === `${LOOPBACK}/api/import`) statuses.push(response.status());
		});
		await page.evaluate((url) => {
			const form = document.createElement('form');
			form.method = 'POST';
			form.action = url;
			form.enctype = 'text/plain';
			form.target = 'sink';
			const frame = document.createElement('iframe');
			frame.name = 'sink';
			const field = document.createElement('input');
			field.name = '{"tessera":1,"deck":{"id":"csrf-deck","title":"CSRF"},"cards":[]}';
			field.value = '';
			form.append(field);
			document.body.append(frame, form);
			form.submit();
		}, `${LOOPBACK}/api/import`);
		await expect.poll(() => statuses.length).toBeGreaterThan(0);
		// SvelteKit refuses it first (403), or the token check does (401). Either way, nothing was imported.
		expect(statuses.every((status) => status === 401 || status === 403)).toBe(true);
		const decks = await page.request.get(`${LOOPBACK}/api/decks`, { headers: bearer });
		expect(JSON.stringify(await decks.json())).not.toContain('csrf-deck');
	});
});
