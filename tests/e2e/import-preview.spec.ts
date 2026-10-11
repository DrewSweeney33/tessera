import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// The import preview shows what a re-import will change before anything is saved (M2-09).

const textbox = (page: Page) => page.getByLabel('Deck (JSON or Markdown)');

async function preview(page: Page, deck: unknown) {
	await page.goto('/import');
	await textbox(page).fill(JSON.stringify(deck));
	await page.getByRole('button', { name: 'Preview' }).click();
}

test('an edited card can be opened to show its old and new text', async ({ page, request }) => {
	const cards = basicCards(2, 'ed');
	await importViaApi(request, deckOf('pv-edit', 'Edits', cards));
	await preview(
		page,
		deckOf('pv-edit', 'Edits', [{ ...cards[0]!, back: 'A better answer' }, cards[1]!])
	);

	const row = page.locator('.changes li', { hasText: 'ed-1' });
	await expect(row).toContainText('updated: back');
	await expect(row.getByText('A better answer')).toBeHidden();
	await row.getByText('Show what changes').click();
	await expect(row.getByRole('heading', { name: 'Answer' })).toBeVisible();
	await expect(row.getByText('Answer 1', { exact: true })).toBeVisible();
	await expect(row.getByText('A better answer')).toBeVisible();
	await expect(row.getByText('Before')).toBeVisible();
	await expect(row.getByText('After')).toBeVisible();
	// The unchanged card is not listed as a change.
	await expect(page.locator('.changes li', { hasText: 'ed-2' })).toHaveCount(0);
});

test('changing a card type warns that its progress starts over', async ({ page, request }) => {
	await importViaApi(request, deckOf('pv-type', 'Retype', basicCards(1, 'ty')));
	await preview(
		page,
		deckOf('pv-type', 'Retype', [{ id: 'ty-1', type: 'typed', front: 'Question 1', answer: 'x' }])
	);

	await expect(page.locator('.warning')).toContainText('1 card changes type ("ty-1")');
	await expect(page.locator('.retype')).toContainText('Progress starts over');
	await expect(page.locator('.changes li', { hasText: 'ty-1' })).toContainText('type changed');
});

test('cards missing from the file are listed, and the archive option changes what is said', async ({
	page,
	request
}) => {
	await importViaApi(request, deckOf('pv-miss', 'Missing', basicCards(4, 'ms')));
	const kept = deckOf('pv-miss', 'Missing', basicCards(2, 'ms'));
	await preview(page, kept);

	await expect(page.getByRole('heading', { name: 'Not in this file (2)' })).toBeVisible();
	await expect(page.getByText('These cards stay exactly as they are.')).toBeVisible();
	await expect(page.locator('.changes li', { hasText: 'ms-3' })).toBeVisible();
	await expect(page.locator('.changes li', { hasText: 'ms-4' })).toBeVisible();

	// Changing the option makes the preview stale, so a new one is needed before importing.
	await page.getByLabel('Archive cards that are not in this file').check();
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByText('These cards will be archived')).toBeVisible();
	await expect(page.locator('.tally')).toContainText('To archive');
});

test('new cards with the content of missing cards are flagged as changed ids', async ({
	page,
	request
}) => {
	await importViaApi(request, deckOf('pv-ids', 'Ids', basicCards(3, 'id')));
	const renamed = basicCards(3, 'id').map((card, i) => ({ ...card, id: `renamed-${i + 1}` }));
	await preview(page, deckOf('pv-ids', 'Ids', renamed));

	await expect(page.locator('.warning')).toContainText(
		'3 new cards have exactly the same content as cards missing from this file'
	);
	await expect(page.locator('.warning')).toContainText('"id-1" is now "renamed-1"');
	await expect(page.locator('.warning')).toContainText('Ask Claude to keep every id');
});

test('an import with no surprises shows no warning', async ({ page, request }) => {
	const deck = deckOf('pv-calm', 'Calm', basicCards(3, 'cm'));
	await importViaApi(request, deck);
	await preview(page, { ...deck, cards: [...deck.cards, ...basicCards(1, 'extra')] });
	await expect(page.getByRole('heading', { name: 'Updating deck: Calm' })).toBeVisible();
	await expect(page.locator('.warning')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: /Not in this file/ })).toHaveCount(0);
});
