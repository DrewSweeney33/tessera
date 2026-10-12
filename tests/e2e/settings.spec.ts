import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// The settings page (M3-09). Settings are global to the server, which every spec shares, so each test puts the
// defaults back afterwards.

const DEFAULTS = {
	targetRetention: 0.9,
	newPerDay: 20,
	reviewsPerDay: 200,
	rolloverHour: 4,
	leechThreshold: 8,
	interleave: false
};

test.afterEach(async ({ request }) => {
	await request.put('/api/settings', {
		headers: { 'content-type': 'application/json' },
		data: JSON.stringify(DEFAULTS)
	});
});

async function open(page: Page) {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await expect(page.getByLabel(/New cards per day/)).toHaveValue('20');
}

async function current(request: APIRequestContext) {
	return ((await (await request.get('/api/settings')).json()) as { settings: typeof DEFAULTS })
		.settings;
}

test.describe('the settings page', () => {
	test('is reached from the deck list and shows the current values, the defaults, and the time zone', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
		await expect(page.getByLabel(/New cards per day/)).toHaveValue('20');
		await expect(page.getByLabel('Reviews per day')).toHaveValue('200');
		await expect(page.getByLabel(/Target retention/)).toHaveValue('90');
		await expect(page.getByLabel('The study day starts at')).toHaveValue('4');
		await expect(page.getByLabel('Leech threshold')).toHaveValue('8');
		await expect(page.getByLabel('Mix new and due cards')).not.toBeChecked();
		await expect(page.getByText('Default 20.')).toBeVisible();
		await expect(page.getByText('America/Chicago')).toBeVisible();
	});

	test('saves a change, says so, and it is still there after a reload and on the server', async ({
		page,
		request
	}) => {
		await open(page);
		const save = page.getByRole('button', { name: 'Save settings' });
		await expect(save).toBeDisabled();
		await page.getByLabel(/New cards per day/).fill('7');
		await expect(save).toBeEnabled();
		await save.click();
		await expect(page.locator('.callout--ok')).toContainText('Saved.');
		await expect(save).toBeDisabled();
		await page.reload();
		await expect(page.getByLabel(/New cards per day/)).toHaveValue('7');
		expect((await current(request)).newPerDay).toBe(7);
	});

	test('a change to new cards per day shows in the deck list at once', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-set-limit', 'E2E settings limit', basicCards(10, 'l')));
		await open(page);
		await page.getByLabel(/New cards per day/).fill('3');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.locator('.callout--ok')).toBeVisible();
		await page.goto('/');
		await expect(
			page.locator('.row', { hasText: 'E2E settings limit' }).locator('.counts')
		).toContainText(/New\s*3/);
	});

	test('keeps retention as a percent on screen and as a fraction on the server', async ({
		page,
		request
	}) => {
		await open(page);
		await page.getByLabel(/Target retention/).fill('85');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.locator('.callout--ok')).toBeVisible();
		expect((await current(request)).targetRetention).toBe(0.85);
		await page.reload();
		await expect(page.getByLabel(/Target retention/)).toHaveValue('85');
	});

	test('saves the study day hour, the leech threshold, and the mixing switch together', async ({
		page,
		request
	}) => {
		await open(page);
		await page.getByLabel('The study day starts at').selectOption('2');
		await page.getByLabel('Leech threshold').fill('5');
		await page.getByLabel('Mix new and due cards').check();
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.locator('.callout--ok')).toBeVisible();
		expect(await current(request)).toMatchObject({
			rolloverHour: 2,
			leechThreshold: 5,
			interleave: true
		});
	});

	test('explains a bad value beside its field, names every bad field, focuses the first, and saves nothing', async ({
		page,
		request
	}) => {
		await open(page);
		await page.getByLabel(/New cards per day/).fill('-3');
		await page.getByLabel('Leech threshold').fill('1');
		await page.getByLabel('Reviews per day').fill('');
		await page.getByRole('button', { name: 'Save settings' }).click();

		const newCards = page.getByLabel(/New cards per day/);
		await expect(newCards).toHaveAttribute('aria-invalid', 'true');
		await expect(newCards).toBeFocused();
		await expect(page.locator('#newPerDay-problem')).toContainText('whole number from 0 to 1000');
		await expect(page.locator('#leechThreshold-problem')).toContainText('from 2 to 100');
		await expect(page.locator('#reviewsPerDay-problem')).toContainText('whole number');
		await expect(page.getByRole('alert')).toContainText('Nothing was saved');
		expect(await current(request)).toEqual(DEFAULTS);
	});

	test('refuses a retention outside 70 to 99', async ({ page, request }) => {
		await open(page);
		await page.getByLabel(/Target retention/).fill('100');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.locator('#targetRetention-problem')).toContainText('between 70% and 99%');
		expect((await current(request)).targetRetention).toBe(0.9);
	});

	test('Discard changes puts back what is saved, and Fill in the defaults only fills the form', async ({
		page,
		request
	}) => {
		await request.put('/api/settings', {
			headers: { 'content-type': 'application/json' },
			data: JSON.stringify({ newPerDay: 12 })
		});
		await open(page).catch(() => undefined);
		await page.goto('/settings');
		await expect(page.getByLabel(/New cards per day/)).toHaveValue('12');
		await page.getByLabel(/New cards per day/).fill('99');
		await page.getByRole('button', { name: 'Discard changes' }).click();
		await expect(page.getByLabel(/New cards per day/)).toHaveValue('12');

		await page.getByRole('button', { name: 'Fill in the defaults' }).click();
		await expect(page.getByLabel(/New cards per day/)).toHaveValue('20');
		// Nothing is saved until Save is pressed.
		expect((await current(request)).newPerDay).toBe(12);
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.locator('.callout--ok')).toBeVisible();
		expect((await current(request)).newPerDay).toBe(20);
	});

	test('works with the keyboard alone, and Enter in a field saves', async ({ page, request }) => {
		await open(page);
		const field = page.getByLabel(/New cards per day/);
		await field.focus();
		await page.keyboard.press('Control+A');
		await page.keyboard.type('11');
		await page.keyboard.press('Enter');
		await expect(page.locator('.callout--ok')).toBeVisible();
		expect((await current(request)).newPerDay).toBe(11);
	});

	test('says what changing the study day hour does', async ({ page }) => {
		await open(page);
		await expect(page.getByText(/Changing the hour moves the line at once/)).toBeVisible();
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await open(page);
			await page.getByLabel(/New cards per day/).fill('-1');
			await page.getByRole('button', { name: 'Save settings' }).click();
			await expect(page.locator('#newPerDay-problem')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
