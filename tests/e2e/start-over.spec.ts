import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Start over (US-14, ADR-013): every card of a deck goes back to new, the review history stays, the title has to be
// typed, and a copy of the data is saved first. Every deck here has its own id, because the specs share one server.

async function newCount(request: APIRequestContext, id: string) {
	const body = (await (await request.get('/api/decks')).json()) as {
		decks: { id: string; counts: { new: number; learning: number; review: number } }[];
	};
	return body.decks.find((deck) => deck.id === id)?.counts;
}

async function studyOne(page: Page, id: string) {
	await page.goto(`/study/${id}`);
	await expect(page.locator('.card')).toBeFocused();
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
}

async function openPanel(page: Page, id: string) {
	await page.goto(`/decks/${id}/edit`);
	await page.getByRole('button', { name: 'Start over…' }).click();
	return page.getByLabel(/Type the deck title to confirm/);
}

test.describe('start over', () => {
	test('puts a studied deck back to new, keeps the history, and names the saved copy', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-reset-basic', 'E2E reset basic', basicCards(3, 'b')));
		await studyOne(page, 'e2e-reset-basic');
		await expect.poll(async () => (await newCount(request, 'e2e-reset-basic'))?.new).toBe(2);

		const typed = await openPanel(page, 'e2e-reset-basic');
		await expect(typed).toBeFocused();
		await typed.fill('E2E reset basic');
		await page.getByRole('button', { name: 'Start over', exact: true }).click();

		await expect(page.locator('.callout--ok').getByText('Started over.')).toBeVisible();
		await expect(page.getByText('3 cards are new again')).toBeVisible();
		await expect(page.getByText('1 review stays')).toBeVisible();
		await expect(page.locator('code', { hasText: /^pre-reset-e2e-reset-basic-/ })).toBeVisible();
		expect((await newCount(request, 'e2e-reset-basic'))?.new).toBe(3);
		expect((await newCount(request, 'e2e-reset-basic'))?.review).toBe(0);

		// And it can be studied again from the start.
		await studyOne(page, 'e2e-reset-basic');
		await expect.poll(async () => (await newCount(request, 'e2e-reset-basic'))?.new).toBe(2);
	});

	test('waits for the exact title', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-reset-title', 'E2E reset title', basicCards(1, 't')));
		const typed = await openPanel(page, 'e2e-reset-title');
		const go = page.getByRole('button', { name: 'Start over', exact: true });
		await expect(go).toBeDisabled();
		for (const wrong of ['e2e reset title', 'E2E reset', 'e2e-reset-title', 'E2E reset title!']) {
			await typed.fill(wrong);
			await expect(go).toBeDisabled();
		}
		await typed.fill('E2E reset title');
		await expect(go).toBeEnabled();
	});

	test('Cancel closes the panel, forgets what was typed, and returns focus to the button', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-reset-cancel', 'E2E reset cancel', basicCards(2, 'c')));
		await studyOne(page, 'e2e-reset-cancel');
		const typed = await openPanel(page, 'e2e-reset-cancel');
		await typed.fill('E2E reset cancel');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(typed).toBeHidden();
		await expect(page.getByRole('button', { name: 'Start over…' })).toBeFocused();
		await page.getByRole('button', { name: 'Start over…' }).click();
		await expect(page.getByLabel(/Type the deck title to confirm/)).toHaveValue('');
		expect((await newCount(request, 'e2e-reset-cancel'))?.new).toBe(1);
	});

	test('works with the keyboard alone, and Enter in the box confirms', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-reset-keys', 'E2E reset keys', basicCards(2, 'k')));
		await studyOne(page, 'e2e-reset-keys');
		await page.goto('/decks/e2e-reset-keys/edit');
		await expect(page.getByRole('heading', { name: 'Edit deck', level: 1 })).toBeVisible();
		const open = page.getByRole('button', { name: 'Start over…' });
		await open.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByLabel(/Type the deck title to confirm/)).toBeFocused();
		await page.keyboard.type('E2E reset keys');
		await page.keyboard.press('Enter');
		await expect(page.locator('.callout--ok').getByText('Started over.')).toBeVisible();
	});

	test('does not touch unsaved edits, and saving afterwards still works', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-reset-edits', 'E2E reset edits', basicCards(2, 'e')));
		await page.goto('/decks/e2e-reset-edits/edit');
		await page.getByRole('button', { name: 'Edit card 1' }).click();
		await page.locator('.card').first().getByLabel('Front').fill('Edited before starting over');
		await page.getByRole('button', { name: 'Start over…' }).click();
		await page.getByLabel(/Type the deck title to confirm/).fill('E2E reset edits');
		await page.getByRole('button', { name: 'Start over', exact: true }).click();
		await expect(page.locator('.callout--ok').getByText('Started over.')).toBeVisible();
		await expect(page.locator('.card').first().getByLabel('Front')).toHaveValue(
			'Edited before starting over'
		);
		await page.getByRole('button', { name: 'Review changes' }).click();
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Saved.', { exact: false }).first()).toBeVisible();
	});

	test('a title with markup is shown as text and never runs', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf(
				'e2e-reset-xss',
				'<img src=x onerror="window.__pwned=7"> E2E reset xss',
				basicCards(1, 'x')
			)
		);
		await page.goto('/decks/e2e-reset-xss/edit');
		await page.getByRole('button', { name: 'Start over…' }).click();
		await expect(page.locator('#reset-confirm .typed-title')).toContainText('<img src=x onerror=');
		expect(await page.locator('#reset-confirm img').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
			undefined
		);
	});

	test('opening Start over closes the Move to Trash question, and the other way round', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-reset-swap', 'E2E reset swap', basicCards(1, 's')));
		await page.goto('/decks/e2e-reset-swap/edit');
		await page.getByRole('button', { name: 'Move to Trash' }).first().click();
		await expect(page.locator('#trash-confirm')).toBeVisible();
		await page.getByRole('button', { name: 'Start over…' }).click();
		await expect(page.locator('#trash-confirm')).toBeHidden();
		await expect(page.locator('#reset-confirm')).toBeVisible();
		await page.getByRole('button', { name: 'Move to Trash' }).first().click();
		await expect(page.locator('#reset-confirm')).toBeHidden();
		await expect(page.locator('#trash-confirm')).toBeVisible();
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px with the panel open`, async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf(
					'e2e-reset-narrow',
					'E2E reset narrow with a long title that wraps ' + 'y'.repeat(60),
					basicCards(1, 'n')
				)
			);
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/decks/e2e-reset-narrow/edit');
			await page.getByRole('button', { name: 'Start over…' }).click();
			await expect(page.locator('#reset-confirm')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
