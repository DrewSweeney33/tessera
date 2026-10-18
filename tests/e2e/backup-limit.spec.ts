import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { passwordPort, passwordServerMaxBackups, passwordValue } from './password-server.ts';

// The backup limit (ADR-021): Back up now keeps at most TESSERA_MAX_BACKUPS backups taken by the person, refuses the
// next with a plain message, shows how many there are, and never deletes one by itself. This runs on the server that
// has the password and a limit of three, signed in through its login.

const BASE = `http://127.0.0.1:${passwordPort}`;
const LIMIT = passwordServerMaxBackups;
test.use({ baseURL: BASE });

const PAGE_HEADERS = { 'content-type': 'application/json', 'x-tessera-client': 'web' };

async function signIn(request: APIRequestContext) {
	const response = await request.post('/api/auth/login', {
		headers: PAGE_HEADERS,
		data: JSON.stringify({ password: passwordValue })
	});
	expect(response.ok()).toBe(true);
}

async function manualBackups(request: APIRequestContext): Promise<string[]> {
	const body = (await (await request.get('/api/backups', { headers: PAGE_HEADERS })).json()) as {
		backups: { name: string; kind: string }[];
	};
	return body.backups.filter((b) => b.kind === 'manual').map((b) => b.name);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
	await signIn(context.request);
	for (const name of await manualBackups(context.request)) {
		await context.request.delete(`/api/backups/${name}`, { headers: PAGE_HEADERS });
	}
});

test.afterAll(async ({ playwright }) => {
	const request = await playwright.request.newContext({ baseURL: BASE });
	await signIn(request);
	for (const name of await manualBackups(request)) {
		await request.delete(`/api/backups/${name}`, { headers: PAGE_HEADERS });
	}
	await request.dispose();
});

test('shows how many backups there are, and stops at the limit with a plain message', async ({
	page,
	context
}) => {
	await page.goto('/backups');
	await expect(page.getByText(`Taken by you: 0 of ${LIMIT}.`)).toBeVisible();
	const button = page.getByRole('button', { name: 'Back up now' });
	await expect(button).toBeEnabled();

	for (let made = 1; made <= LIMIT; made += 1) {
		await button.click();
		await expect(page.getByText(`Taken by you: ${made} of ${LIMIT}.`)).toBeVisible();
	}

	await expect(button).toBeDisabled();
	const notice = page.locator('#backup-limit');
	await expect(notice).toContainText(`You have ${LIMIT} of ${LIMIT} backups.`);
	await expect(notice).toContainText('Delete one you no longer need below');
	await expect(notice).toContainText('Tessera never deletes a backup for you');
	await expect(button).toHaveAccessibleDescription(/You have 3 of 3 backups/);

	// The server refuses too, with the reason a script can read, and nothing was deleted or written.
	const refused = await context.request.post('/api/backups', { headers: PAGE_HEADERS, data: '{}' });
	expect(refused.status()).toBe(409);
	const body = (await refused.json()) as {
		error: { code: string; message: string; details: { manualCount: number; maxManual: number } };
	};
	expect(body.error.code).toBe('backup_limit');
	expect(body.error.message).toContain('Delete one');
	expect(body.error.details).toEqual({ manualCount: LIMIT, maxManual: LIMIT });
	expect(await manualBackups(context.request)).toHaveLength(LIMIT);
});

test('deleting one frees a place, and Back up now works again', async ({ page, context }) => {
	for (let i = 0; i < LIMIT; i += 1) {
		const made = await context.request.post('/api/backups', { headers: PAGE_HEADERS, data: '{}' });
		expect(made.status()).toBe(201);
	}
	await page.goto('/backups');
	const button = page.getByRole('button', { name: 'Back up now' });
	await expect(button).toBeDisabled();

	const [name] = await manualBackups(context.request);
	const row = page.locator('.row', { hasText: name! });
	await row.getByRole('button', { name: `Delete ${name}` }).click();
	await row.getByRole('button', { name: `Yes, delete ${name}` }).click();
	await expect(page.getByText(`Taken by you: ${LIMIT - 1} of ${LIMIT}.`)).toBeVisible();
	await expect(page.locator('#backup-limit')).toHaveCount(0);
	await expect(button).toBeEnabled();

	await button.click();
	await expect(page.locator('.callout--ok code')).toHaveText(/^manual-.*\.db$/);
	await expect(button).toBeDisabled();
	expect(await manualBackups(context.request)).toHaveLength(LIMIT);
});

test('the safety copies Tessera makes are shown, not counted, and not refused', async ({
	page,
	context
}) => {
	// Deleting a deck for good makes a safety copy first.
	const json = { headers: PAGE_HEADERS };
	const deck = {
		tessera: 1,
		deck: { id: 'e2e-limit-deck', title: 'E2E limit deck' },
		cards: [{ id: 'c1', type: 'basic', front: 'Q', back: 'A' }]
	};
	expect(
		(await context.request.post('/api/import', { ...json, data: JSON.stringify(deck) })).ok()
	).toBe(true);
	await context.request.post('/api/decks/e2e-limit-deck/trash', { ...json, data: '{}' });
	const gone = await context.request.post('/api/decks/e2e-limit-deck/delete-forever', {
		...json,
		data: JSON.stringify({ confirmTitle: 'E2E limit deck' })
	});
	expect(gone.ok()).toBe(true);

	for (let i = 0; i < LIMIT; i += 1) {
		await context.request.post('/api/backups', { ...json, data: '{}' });
	}
	await page.goto('/backups');
	await expect(page.getByText(`Taken by you: ${LIMIT} of ${LIMIT}.`)).toBeVisible();
	await expect(page.getByText(/Safety copies Tessera made itself: \d+\s+\(/)).toBeVisible();
	await expect(page.getByText(/not counted/)).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`the Backups page at the limit passes the accessibility scan, ${scheme} theme`, async ({
		browser,
		context
	}) => {
		for (let i = 0; i < LIMIT; i += 1) {
			await context.request.post('/api/backups', { headers: PAGE_HEADERS, data: '{}' });
		}
		const themed = await browser.newContext({ baseURL: BASE, colorScheme: scheme });
		try {
			await signIn(themed.request);
			const page = await themed.newPage();
			await page.goto('/backups');
			await expect(page.locator('#backup-limit')).toBeVisible();
			await page.evaluate(() =>
				Promise.all(
					document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
				)
			);
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
				.analyze();
			expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
		} finally {
			await themed.close();
		}
	});
}
