import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// The Backups page (US-15, ADR-014): back up now, see every backup with why it was taken, download one, delete one.
// The specs share one server and its backups folder, so each test finds its own backup by name.

const JSON_HEADERS = { 'content-type': 'application/json' };

async function listBackups(request: APIRequestContext) {
	const body = (await (await request.get('/api/backups')).json()) as {
		backups: { name: string; kind: string; size: number }[];
	};
	return body.backups;
}

test.describe('the Backups page', () => {
	test('is reached from the deck list', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Backups' }).first().click();
		await expect(page.getByRole('heading', { name: 'Backups', level: 1 })).toBeVisible();
	});

	test('Back up now saves a copy, names it, and lists it as taken by you', async ({
		page,
		request
	}) => {
		await page.goto('/backups');
		await page.getByRole('button', { name: 'Back up now' }).click();
		const saved = page.locator('.callout--ok code');
		await expect(saved).toHaveText(/^manual-.*\.db$/);
		const name = (await saved.textContent())!;
		const row = page.locator('.row', { hasText: name });
		await expect(row).toContainText('Taken by you');
		await expect(row).toContainText(/\d+(\.\d)? (kB|MB)/);
		expect((await listBackups(request)).map((b) => b.name)).toContain(name);
	});

	test('Download gives the file under its own name, and it is a real database', async ({
		page
	}) => {
		await page.goto('/backups');
		await page.getByRole('button', { name: 'Back up now' }).click();
		const name = (await page.locator('.callout--ok code').textContent())!;
		const downloading = page.waitForEvent('download');
		await page.getByRole('button', { name: `Download ${name}` }).click();
		const download = await downloading;
		expect(download.suggestedFilename()).toBe(name);
		const path = await download.path();
		expect(readFileSync(path).subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
	});

	test('Delete asks first, Keep it leaves the backup, and Delete removes it', async ({
		page,
		request
	}) => {
		await page.goto('/backups');
		await page.getByRole('button', { name: 'Back up now' }).click();
		const name = (await page.locator('.callout--ok code').textContent())!;
		const row = page.locator('.row', { hasText: name });

		await row.getByRole('button', { name: `Delete ${name}` }).click();
		await expect(row.getByText('Delete this backup?')).toBeVisible();
		await row.getByRole('button', { name: 'Keep it' }).click();
		await expect(row.getByText('Delete this backup?')).toBeHidden();
		expect((await listBackups(request)).map((b) => b.name)).toContain(name);

		await row.getByRole('button', { name: `Delete ${name}` }).click();
		await row.getByRole('button', { name: `Yes, delete ${name}` }).click();
		await expect(row).toBeHidden();
		expect((await listBackups(request)).map((b) => b.name)).not.toContain(name);
	});

	test('shows the copies the app takes itself, with why', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-backup-forever', 'E2E backup forever', basicCards(1, 'f'))
		);
		await request.post('/api/decks/e2e-backup-forever/trash', {
			headers: JSON_HEADERS,
			data: '{}'
		});
		const gone = await request.post('/api/decks/e2e-backup-forever/delete-forever', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ confirmTitle: 'E2E backup forever' })
		});
		const name = ((await gone.json()) as { deleted: { snapshot: { name: string } } }).deleted
			.snapshot.name;
		await page.goto('/backups');
		const row = page.locator('.row', { hasText: name });
		await expect(row).toContainText('Before a deck was deleted for good');
	});

	test('says so when there are no backups', async ({ page, request }) => {
		for (const backup of await listBackups(request)) {
			await request.delete(`/api/backups/${encodeURIComponent(backup.name)}`, {
				headers: JSON_HEADERS
			});
		}
		await page.goto('/backups');
		await expect(page.getByText('There are no backups yet.')).toBeVisible();
	});

	test('warns that a backup on the same disk is not enough', async ({ page }) => {
		await page.goto('/backups');
		await expect(page.getByText('does not protect you if the disk is lost')).toBeVisible();
	});

	test('works with the keyboard alone', async ({ page }) => {
		await page.goto('/backups');
		const button = page.getByRole('button', { name: 'Back up now' });
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('.callout--ok code')).toHaveText(/^manual-/);
		const name = (await page.locator('.callout--ok code').textContent())!;
		await page.getByRole('button', { name: `Delete ${name}` }).focus();
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: `Yes, delete ${name}` }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('.row', { hasText: name })).toBeHidden();
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px with a delete question open`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/backups');
			await page.getByRole('button', { name: 'Back up now' }).click();
			const name = (await page.locator('.callout--ok code').textContent())!;
			await page.getByRole('button', { name: `Delete ${name}` }).click();
			await expect(page.getByText('Delete this backup?')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
