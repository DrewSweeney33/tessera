import { expect, test } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

const BAD_DECK = JSON.stringify({
	tessera: 1,
	deck: { id: 'bad-deck', title: 'Bad deck' },
	cards: [{ id: 'a', type: 'basic', front: 'Only a question' }]
});

test('import a deck and study it using only the keyboard', async ({ page }) => {
	const deck = JSON.stringify(deckOf('kb-flow', 'Keyboard flow', basicCards(3, 'kb')), null, 2);
	await page.goto('/import');

	const preview = page.getByRole('button', { name: 'Preview' });
	const importButton = page.getByRole('button', { name: 'Import', exact: true });
	await expect(preview).toBeDisabled();
	await expect(importButton).toBeDisabled();

	await page.getByLabel('Deck (JSON)').fill(deck);
	await preview.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'New deck: Keyboard flow' })).toBeVisible();
	await expect(page.locator('.tally')).toContainText('3');
	await expect(importButton).toBeEnabled();

	// Changing the text after a preview makes the preview stale, and import must wait for a new one.
	await page.getByLabel('Deck (JSON)').fill(deck + '\n');
	await expect(page.getByRole('heading', { name: 'New deck: Keyboard flow' })).toBeHidden();
	await expect(importButton).toBeDisabled();

	await preview.focus();
	await page.keyboard.press('Enter');
	await expect(importButton).toBeEnabled();
	await importButton.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
	await expect(page.locator('.callout--ok')).toContainText('3 new, 0 updated');

	await page.getByRole('link', { name: 'Study this deck' }).click();
	await expect(page).toHaveURL(/\/study\/kb-flow$/);

	for (let i = 0; i < 3; i++) {
		await expect(page.locator('.card')).toBeFocused();
		await page.keyboard.press('Space');
		await expect(page.locator('.card__back')).toBeVisible();
		// Easy graduates a new card to review, so nothing is left for today.
		await page.keyboard.press('4');
	}
	await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Keyboard flow' })).toBeVisible();
});

test('a card in a learning step comes back as the last resort instead of ending the session', async ({
	page,
	request
}) => {
	await importViaApi(request, deckOf('learning', 'Learning', basicCards(1, 'ln')));
	await page.goto('/study/learning');

	await expect(page.locator('.card__category')).toHaveText('New');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');

	// Nothing else is due, so the card in its learning step is offered again (ADR-003).
	await expect(page.locator('.card__category')).toHaveText('Learning');
	await expect(page.locator('.card__front')).toContainText('Question 1');
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
	await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
});

test('importing the same deck twice reports that nothing changed', async ({ page, request }) => {
	const deck = deckOf('twice', 'Twice', basicCards(2, 'tw'));
	await importViaApi(request, deck);

	await page.goto('/import');
	await page.getByLabel('Deck (JSON)').fill(JSON.stringify(deck));
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: 'Updating deck: Twice' })).toBeVisible();
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Nothing changed' })).toBeVisible();
	await expect(page.getByText('so no review progress was touched')).toBeVisible();
});

test('a broken deck lists what to fix and offers a message for Claude', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/import');
	await page.getByLabel('Deck (JSON)').fill(BAD_DECK);
	await page.getByRole('button', { name: 'Preview' }).click();

	await expect(page.getByRole('heading', { name: /problems? to fix/ })).toBeVisible();
	await expect(page.locator('.problems li').first()).toContainText('back');
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

	await page.getByRole('button', { name: 'Copy errors for Claude' }).click();
	await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toContain('Keep every card "id" unchanged');
	expect(clipboard).toContain('/api/schema');
	expect(clipboard).toContain('Problems:');
});

test('when copying is blocked the message is shown for manual copy', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		document.execCommand = () => false;
	});
	await page.goto('/import');
	await page.getByLabel('Deck (JSON)').fill(BAD_DECK);
	await page.getByRole('button', { name: 'Preview' }).click();
	await page.getByRole('button', { name: 'Copy errors for Claude' }).click();

	const manual = page.getByLabel('Your browser blocked copying. Select and copy this text:');
	await expect(manual).toBeVisible();
	await expect(manual).toHaveValue(/Keep every card "id" unchanged/);
});

test('invalid JSON points at the line and column', async ({ page }) => {
	await page.goto('/import');
	await page
		.getByLabel('Deck (JSON)')
		.fill('{\n  "tessera": 1,\n  "deck": { "id": "x", "title": "X" },\n  "cards": [ ,\n}');
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.locator('.problems .where').first()).toContainText(/line \d+/);
});

test('the home page and its navigation render', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Import' })).toBeVisible();
});
