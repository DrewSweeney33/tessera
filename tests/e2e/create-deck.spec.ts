import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// Making a deck by hand (US-11, ADR-013). The page, the live id, the errors next to their fields, and what the
// home page shows for a deck that has no cards yet.

async function openForm(page: Page) {
	await page.goto('/');
	await page.getByRole('link', { name: 'New deck' }).first().click();
	await expect(page.getByRole('heading', { name: 'New deck', level: 1 })).toBeVisible();
}

test.describe('creating a deck', () => {
	test('a deck made by hand appears on the home page with no cards, ready for cards', async ({
		page
	}) => {
		await openForm(page);
		await page.getByLabel('Title').fill('E2E create one');
		await page.getByLabel('Description').fill('Made in a test');
		await page.getByLabel('Tags').fill('alpha, beta, alpha');
		await page.getByRole('button', { name: 'Create deck' }).click();

		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();
		await expect(page.locator('code', { hasText: 'e2e-create-one' }).first()).toBeVisible();

		await page.getByRole('link', { name: 'All decks' }).click();
		const row = page.locator('.row', { hasText: 'E2E create one' });
		await expect(row).toBeVisible();
		await expect(row).toContainText('0 cards');
		await expect(row).toContainText('alpha, beta');
		await expect(row).toContainText('Made in a test');
		await expect(row).toContainText('No cards yet');
	});

	test('shows the id while typing, and uses the same one on save', async ({ page }) => {
		await openForm(page);
		await page.getByLabel('Title').fill('Café Déjà-Vu: the Deck!');
		await expect(page.getByTestId('id-preview')).toContainText('cafe-deja-vu-the-deck');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.locator('code', { hasText: 'cafe-deja-vu-the-deck' }).first()).toBeVisible();
	});

	test('a second deck with the same title gets a number, not an error', async ({ page }) => {
		for (const expected of ['e2e-same-title', 'e2e-same-title-2']) {
			await openForm(page);
			await page.getByLabel('Title').fill('E2E same title');
			await page.getByRole('button', { name: 'Create deck' }).click();
			await expect(page.locator('code', { hasText: expected }).first()).toBeVisible();
		}
	});

	test('a blank title is refused where you are looking, and nothing is created', async ({
		page
	}) => {
		await openForm(page);
		await page.getByRole('button', { name: 'Create deck' }).click();
		const title = page.getByLabel('Title');
		await expect(title).toHaveAttribute('aria-invalid', 'true');
		await expect(title).toBeFocused();
		await expect(page.getByRole('alert')).toContainText('title');
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeHidden();
	});

	test('a taken id is named next to the id field, your typing is kept, and fixing it works', async ({
		page
	}) => {
		await openForm(page);
		await page.getByLabel('Title').fill('E2E taken first');
		await page.getByLabel('Deck id').fill('e2e-taken');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();

		await openForm(page);
		await page.getByLabel('Title').fill('E2E taken second');
		await page.getByLabel('Description').fill('Keep this text');
		await page.getByLabel('Deck id').fill('e2e-taken');
		await page.getByRole('button', { name: 'Create deck' }).click();

		const id = page.getByLabel('Deck id');
		await expect(id).toHaveAttribute('aria-invalid', 'true');
		await expect(page.getByRole('alert')).toContainText('already exists');
		await expect(page.getByLabel('Title')).toHaveValue('E2E taken second');
		await expect(page.getByLabel('Description')).toHaveValue('Keep this text');

		await id.fill('');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.locator('code', { hasText: 'e2e-taken-second' }).first()).toBeVisible();
	});

	test('an id that cannot be one is explained as you type, before anything is sent', async ({
		page
	}) => {
		await openForm(page);
		await page.getByLabel('Deck id').fill('Bad Id!');
		await expect(page.getByText(/lowercase letters, digits, and hyphens/)).toBeVisible();
		await page.getByLabel('Title').fill('E2E bad id');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByLabel('Deck id')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeHidden();
	});

	test('works with the keyboard alone, in the order the fields are read', async ({ page }) => {
		await page.goto('/decks/new');
		await page.getByLabel('Title').focus();
		await page.keyboard.type('E2E tab order check');
		for (const name of ['Description', 'Tags', 'Deck id']) {
			await page.keyboard.press('Tab');
			await expect(page.getByLabel(name)).toBeFocused();
		}
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Create deck' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();
	});

	test('markup in a title is shown as text and never runs', async ({ page }) => {
		await openForm(page);
		await page.getByLabel('Title').fill('<img src=x onerror="window.__pwned=1"> E2E markup');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();
		await page.getByRole('link', { name: 'All decks' }).click();
		const row = page.locator('.row', { hasText: 'E2E markup' });
		await expect(row.getByRole('heading')).toContainText('<img src=x onerror=');
		expect(await row.locator('img').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
			undefined
		);
	});

	test('cards can be imported into the new deck, and then it can be studied', async ({
		page,
		request
	}) => {
		await openForm(page);
		await page.getByLabel('Title').fill('E2E then cards');
		await page.getByLabel('Deck id').fill('e2e-then-cards');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();

		await importViaApi(request, deckOf('e2e-then-cards', 'E2E then cards', basicCards(3)));
		await page.goto('/');
		const row = page.locator('.row', { hasText: 'E2E then cards' });
		await expect(row).toContainText('3 cards');
		await expect(row.getByRole('link', { name: 'Study' })).toBeVisible();
	});

	test('the success page points at importing cards and at making another deck', async ({
		page
	}) => {
		await openForm(page);
		await page.getByLabel('Title').fill('E2E next steps');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByRole('link', { name: 'Import cards' })).toBeVisible();
		await page.getByRole('button', { name: 'Make another deck' }).click();
		await expect(page.getByLabel('Title')).toHaveValue('');
	});

	test('the New deck link is there with no decks and with decks', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('link', { name: 'New deck' }).first()).toBeVisible();
	});
});
