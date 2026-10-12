import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Restoring from the Backups page (US-15, ADR-014). The page reads the real backups and the real preview from the
// test server. The restore request and the health check are stubbed here, because a real restore stops the server,
// and this server has nothing to start it again. The staging, the stop, and the apply at the next start are covered
// by the integration tests and, on a real Docker host, by the live-image harness.

const DATA = '.e2e-data';

async function newBackup(page: Page): Promise<string> {
	await page.goto('/backups');
	await page.getByRole('button', { name: 'Back up now' }).click();
	return (await page.locator('.callout--ok code').textContent())!;
}

test.describe('the restore panel', () => {
	test('shows what the backup holds beside what is there now, and waits for the word', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-restore-a', 'E2E restore a', basicCards(2, 'a')));
		const name = await newBackup(page);
		await importViaApi(request, deckOf('e2e-restore-b', 'E2E restore b', basicCards(3, 'b')));
		await page.reload();

		await page.getByRole('button', { name: `Restore ${name}` }).click();
		const panel = page.locator(`[id="restore-panel-${name}"]`);
		await expect(panel.getByRole('table')).toBeVisible();
		// The backup was taken before deck b: the "now" column has 1 deck and 3 cards more.
		const decks = panel.getByRole('row', { name: /Decks/ });
		const cards = panel.getByRole('row', { name: /Cards/ });
		const [thenDecks, nowDecks] = (await decks.getByRole('cell').allTextContents()).map(Number);
		const [thenCards, nowCards] = (await cards.getByRole('cell').allTextContents()).map(Number);
		expect(nowDecks! - thenDecks!).toBe(1);
		expect(nowCards! - thenCards!).toBe(3);
		await expect(panel).toContainText('replaces everything in Tessera with this backup');

		const word = page.getByLabel(/to confirm/);
		await expect(word).toBeFocused();
		const go = panel.getByRole('button', { name: 'Restore this backup' });
		await expect(go).toBeDisabled();
		for (const wrong of ['Restore', 'restor', 'yes', 'restore now']) {
			await word.fill(wrong);
			await expect(go).toBeDisabled();
		}
		await word.fill('restore');
		await expect(go).toBeEnabled();
	});

	test('Cancel closes the panel and returns focus to the button that opened it', async ({
		page
	}) => {
		const name = await newBackup(page);
		await page.getByRole('button', { name: `Restore ${name}` }).click();
		await expect(page.getByLabel(/to confirm/)).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByLabel(/to confirm/)).toBeHidden();
		await expect(page.getByRole('button', { name: `Restore ${name}` })).toBeFocused();
	});

	test('says why a file that is not a database cannot be restored, and offers no way to do it', async ({
		page
	}) => {
		mkdirSync(join(DATA, 'backups'), { recursive: true });
		const file = 'junk-e2e-restore.db';
		writeFileSync(join(DATA, 'backups', file), 'this is not a database '.repeat(40));
		try {
			await page.goto('/backups');
			await page.getByRole('button', { name: `Restore ${file}` }).click();
			await expect(page.getByText('This backup cannot be restored')).toBeVisible();
			await expect(page.getByText('not a SQLite database')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Restore this backup' })).toBeDisabled();
			await expect(page.getByLabel(/to confirm/)).toBeDisabled();
		} finally {
			rmSync(join(DATA, 'backups', file), { force: true });
		}
	});

	test('sends only the typed word, then waits for Tessera to stop and come back', async ({
		page
	}) => {
		const name = await newBackup(page);
		let body: unknown;
		await page.route(`**/api/backups/${name}/restore`, async (route) => {
			body = route.request().postDataJSON();
			await route.fulfill({
				status: 202,
				contentType: 'application/json',
				body: JSON.stringify({ restoring: { name, safetyCopy: 'pre-restore-test.db' } })
			});
		});
		// Down twice (the server stopping), then up again.
		let calls = 0;
		await page.route('**/healthz', async (route) => {
			calls++;
			if (calls <= 2) await route.abort('connectionrefused');
			else await route.continue();
		});

		await page.getByRole('button', { name: `Restore ${name}` }).click();
		await page.getByLabel(/to confirm/).fill('restore');
		await page.getByRole('button', { name: 'Restore this backup' }).click();

		await expect(page.getByRole('heading', { name: 'Restoring…' })).toBeVisible();
		await expect(page.locator('code', { hasText: 'pre-restore-test.db' })).toBeVisible();
		expect(body).toEqual({ confirm: 'restore' });
		await expect(page.getByRole('heading', { name: 'Restored' })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByRole('link', { name: 'Go to your decks' })).toBeVisible();
	});

	test('says what to do when Tessera does not come back', async ({ page }) => {
		const name = await newBackup(page);
		await page.clock.install();
		await page.route(`**/api/backups/${name}/restore`, (route) =>
			route.fulfill({
				status: 202,
				contentType: 'application/json',
				body: JSON.stringify({ restoring: { name, safetyCopy: 'pre-restore-test.db' } })
			})
		);
		await page.route('**/healthz', (route) => route.abort('connectionrefused'));

		await page.getByRole('button', { name: `Restore ${name}` }).click();
		await page.getByLabel(/to confirm/).fill('restore');
		await page.getByRole('button', { name: 'Restore this backup' }).click();
		await expect(page.getByRole('heading', { name: 'Restoring…' })).toBeVisible();
		await page.clock.fastForward(100_000);
		await expect(
			page.getByRole('heading', { name: 'Tessera has not come back yet' })
		).toBeVisible();
		await expect(page.getByText('unless-stopped').first()).toBeVisible();
		await expect(page.getByText('Your data is safe.')).toBeVisible();
	});

	test('shows a refusal from the server beside the panel and keeps it open', async ({ page }) => {
		const name = await newBackup(page);
		await page.route(`**/api/backups/${name}/restore`, (route) =>
			route.fulfill({
				status: 507,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: 'storage_full', message: 'The disk that holds the Tessera data is full.' }
				})
			})
		);
		await page.getByRole('button', { name: `Restore ${name}` }).click();
		await page.getByLabel(/to confirm/).fill('restore');
		await page.getByRole('button', { name: 'Restore this backup' }).click();
		await expect(page.getByRole('alert').filter({ hasText: 'disk' })).toBeVisible();
		await expect(page.getByLabel(/to confirm/)).toBeFocused();
		await expect(page.getByRole('heading', { name: 'Restoring…' })).toBeHidden();
	});

	test('works with the keyboard alone', async ({ page }) => {
		const name = await newBackup(page);
		await page.route(`**/api/backups/${name}/restore`, (route) =>
			route.fulfill({
				status: 202,
				contentType: 'application/json',
				body: JSON.stringify({ restoring: { name, safetyCopy: 'pre-restore-test.db' } })
			})
		);
		await page.route('**/healthz', (route) => route.abort('connectionrefused'));
		const open = page.getByRole('button', { name: `Restore ${name}` });
		await open.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByLabel(/to confirm/)).toBeFocused();
		await page.keyboard.type('restore');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { name: 'Restoring…' })).toBeVisible();
	});

	test('reports what the last start did about a restore', async ({ page }) => {
		const file = join(DATA, 'restore-result.json');
		mkdirSync(DATA, { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({
				ok: false,
				name: 'manual-gone.db',
				at: '2026-10-12T12:30:00.000Z',
				message: 'There is no such backup. The data was not changed.'
			})
		);
		try {
			await page.goto('/backups');
			await expect(page.getByText('The last restore did not happen')).toBeVisible();
			await expect(page.getByText('The data was not changed.')).toBeVisible();
		} finally {
			rmSync(file, { force: true });
		}
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px with the panel open`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			const name = await newBackup(page);
			await page.getByRole('button', { name: `Restore ${name}` }).click();
			await expect(page.getByRole('table')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
