import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// The Markdown deck format, through the real import page.

const MARKDOWN = `---
tessera: 1
id: md-flow
title: Markdown flow
---

## md-1
Q: What does **OSPF** stand for?
A: Open Shortest Path First

## md-2
Cloze: The {{c1::DR}} is elected on a multi-access network.

## md-3
Q: Which port does SSH use?
Answer: 22
Accept: tcp 22

## md-4
Q: Pick the routing protocol
Choices:
- RIP
- [x] OSPF
- ARP
Explanation: ARP maps addresses, it does not route.
`;

const textbox = (page: Page) => page.getByLabel('Deck (JSON or Markdown)');

test('paste a Markdown deck, preview it, import it, and study it', async ({ page }) => {
	await page.goto('/import');
	await textbox(page).fill(MARKDOWN);
	await expect(page.getByText('Reading this as Markdown.')).toBeVisible();

	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: 'New deck: Markdown flow' })).toBeVisible();
	// Four cards, one of them a cloze with a single blank.
	await expect(page.locator('.tally')).toContainText('4');

	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.locator('.callout--ok')).toContainText('4 new, 0 updated');

	await page.getByRole('link', { name: 'Study this deck' }).click();
	await expect(page).toHaveURL(/\/study\/md-flow$/);
	await expect(page.locator('.card')).toBeVisible();
});

test('a JSON deck is still read as JSON', async ({ page }) => {
	await page.goto('/import');
	await textbox(page).fill(JSON.stringify(deckOf('still-json', 'Still JSON', basicCards(1))));
	await expect(page.getByText('Reading this as JSON.')).toBeVisible();
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: 'New deck: Still JSON' })).toBeVisible();
});

test('the page works out the format again when the text changes', async ({ page }) => {
	await page.goto('/import');
	await textbox(page).fill(MARKDOWN);
	await expect(page.getByText('Reading this as Markdown.')).toBeVisible();
	await textbox(page).fill(JSON.stringify(deckOf('x', 'X', basicCards(1))));
	await expect(page.getByText('Reading this as JSON.')).toBeVisible();
	await expect(page.getByText('Reading this as Markdown.')).toBeHidden();
});

test('a .md file imports, and the file name is recorded', async ({ page }) => {
	await page.goto('/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'networking.md',
		mimeType: 'text/markdown',
		buffer: Buffer.from(MARKDOWN, 'utf8')
	});
	await expect(textbox(page)).toHaveValue(MARKDOWN);
	await expect(page.getByText('networking.md')).toBeVisible();
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: /: Markdown flow/ })).toBeVisible();
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: /^(Imported|Nothing changed)$/ })).toBeVisible();
});

test('a Markdown file with a byte order mark and Windows line endings imports', async ({
	page
}) => {
	await page.goto('/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'windows.md',
		mimeType: 'text/markdown',
		buffer: Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from(MARKDOWN.replace(/\n/g, '\r\n'), 'utf8')
		])
	});
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: /: Markdown flow/ })).toBeVisible();
});

test('a deck pasted from a chat inside a code fence imports', async ({ page }) => {
	await page.goto('/import');
	await textbox(page).fill('```markdown\n' + MARKDOWN + '```\n');
	await expect(page.getByText('Reading this as Markdown.')).toBeVisible();
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: /: Markdown flow/ })).toBeVisible();
});

test('the same deck as JSON and as Markdown is one deck: the second import changes nothing', async ({
	page,
	request
}) => {
	await importViaApi(
		request,
		deckOf('same-deck', 'Same deck', [
			{ id: 'one', type: 'basic', front: 'First question', back: 'First answer' },
			{ id: 'two', type: 'cloze', text: 'The {{c1::sky}} is blue.' }
		])
	);

	await page.goto('/import');
	await textbox(page).fill(
		[
			'---',
			'tessera: 1',
			'id: same-deck',
			'title: Same deck',
			'---',
			'',
			'## one',
			'Q: First question',
			'A: First answer',
			'',
			'## two',
			'Cloze: The {{c1::sky}} is blue.',
			''
		].join('\n')
	);
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('heading', { name: 'Updating deck: Same deck' })).toBeVisible();
	await expect(page.locator('.tally')).toContainText('Unchanged');
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Nothing changed' })).toBeVisible();
});

test('a mistake in a Markdown deck is shown with its line number and can be copied for Claude', async ({
	page
}) => {
	await page.goto('/import');
	await textbox(page).fill(MARKDOWN.replace('Answer: 22', 'Anser: 22'));
	await page.getByRole('button', { name: 'Preview' }).click();

	const where = page.locator('.problems .where').first();
	await expect(where).toBeVisible();
	await expect(where).toContainText(/line \d+/);
	await expect(page.getByRole('button', { name: 'Copy errors for Claude' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('text that starts like Markdown but is not a deck gives an error list, not a crash', async ({
	page
}) => {
	await page.goto('/import');
	await textbox(page).fill('---\nnot: a deck\n---\n');
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled();
});
