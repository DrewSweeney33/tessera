import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// Moving cards up and down in the editor (backlog B-4). Every deck has its own id because the specs share one server.

async function texts(page: Page): Promise<string[]> {
	return page.locator('.card__text').allTextContents();
}

test.describe('card order in the editor', () => {
	test('moves a card with the buttons, keeps focus on the button, and saves the order', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-order-1', 'Order one', basicCards(5, 'o1')));
		await page.goto('/decks/e2e-order-1/edit');
		await expect(page.locator('.card')).toHaveCount(5);
		expect((await texts(page)).map((t) => t.trim())).toEqual([
			'Question 1',
			'Question 2',
			'Question 3',
			'Question 4',
			'Question 5'
		]);
		await expect(page.getByText('No changes yet.')).toBeVisible();

		// The ends cannot move past the ends.
		await expect(page.getByRole('button', { name: 'Move card 1 up' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Move card 5 down' })).toBeDisabled();

		await page.getByRole('button', { name: 'Move card 3 up' }).click();
		expect((await texts(page)).map((t) => t.trim())).toEqual([
			'Question 1',
			'Question 3',
			'Question 2',
			'Question 4',
			'Question 5'
		]);
		await expect(
			page.getByRole('status').filter({ hasText: 'Card moved to number 2 of 5.' })
		).toBeAttached();
		// Focus stays on the same card's Up button, so another press moves it again.
		await expect(page.getByRole('button', { name: 'Move card 2 up' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Move card 1 down' })).toBeFocused();
		expect((await texts(page))[0]!.trim()).toBe('Question 3');
		await expect(page.getByText('card order changed')).toBeVisible();

		await page.getByRole('button', { name: 'Review changes' }).click();
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('The new card order is kept')).toBeVisible();
		await expect(page.getByText('No changes yet.')).toBeVisible();

		// It is kept: after a reload, and in the order the cards are studied.
		await page.reload();
		await expect(page.locator('.card')).toHaveCount(5);
		expect((await texts(page)).map((t) => t.trim())).toEqual([
			'Question 3',
			'Question 1',
			'Question 2',
			'Question 4',
			'Question 5'
		]);
		await page.goto('/study/e2e-order-1');
		await expect(page.getByText('Question 3')).toBeVisible();
	});

	test('moving a card and moving it back is no change', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-order-2', 'Order two', basicCards(3, 'o2')));
		await page.goto('/decks/e2e-order-2/edit');
		await page.getByRole('button', { name: 'Move card 1 down' }).click();
		await expect(page.getByText('card order changed')).toBeVisible();
		await page.getByRole('button', { name: 'Move card 2 up' }).click();
		await expect(page.getByText('No changes yet.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Review changes' })).toBeDisabled();
	});

	test('the buttons wait while a search narrows the list', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-order-3', 'Order three', basicCards(25, 'o3')));
		await page.goto('/decks/e2e-order-3/edit');
		await expect(page.getByRole('button', { name: 'Move card 2 up' })).toBeEnabled();
		await page.getByLabel('Find a card').fill('Question 7');
		await expect(page.getByRole('button', { name: 'Move card 7 up' })).toBeDisabled();
		await page.getByLabel('Find a card').fill('');
		await expect(page.getByRole('button', { name: 'Move card 7 up' })).toBeEnabled();
	});

	test('a save from a stale copy is still refused after another tab reordered', async ({
		page,
		browser,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-order-4', 'Order four', basicCards(3, 'o4')));
		await page.goto('/decks/e2e-order-4/edit');
		await page.getByRole('button', { name: 'Move card 3 up' }).click();

		const other = await browser.newPage();
		await other.goto('/decks/e2e-order-4/edit');
		await other.getByRole('button', { name: 'Move card 1 down' }).click();
		await other.getByRole('button', { name: 'Review changes' }).click();
		await other.getByRole('button', { name: 'Save changes' }).click();
		await expect(other.getByText('The new card order is kept')).toBeVisible();
		await other.close();

		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(page.getByText('This deck changed somewhere else.')).toBeVisible();
	});

	test('the move buttons are 44 px touch targets that fit at 320px', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-order-5', 'Order five', basicCards(3, 'o5')));
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/decks/e2e-order-5/edit');
		for (const name of ['Move card 2 up', 'Move card 2 down']) {
			const box = (await page.getByRole('button', { name }).boundingBox())!;
			expect(box.width).toBeGreaterThanOrEqual(43.5);
			expect(box.height).toBeGreaterThanOrEqual(43.5);
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth
			)
		).toBe(false);
	});
});
