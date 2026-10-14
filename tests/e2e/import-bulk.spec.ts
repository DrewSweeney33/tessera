import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf } from './helpers.ts';

// Choosing several deck files at once, through the real import page.

const json = (name: string, id: string, title: string, cards = 2) => ({
	name,
	mimeType: 'application/json',
	buffer: Buffer.from(JSON.stringify(deckOf(id, title, basicCards(cards))), 'utf8')
});

const markdown = (name: string, id: string, title: string) => ({
	name,
	mimeType: 'text/markdown',
	buffer: Buffer.from(
		`---\ntessera: 1\nid: ${id}\ntitle: ${title}\n---\n\n## one\nQ: First question\nA: First answer\n`,
		'utf8'
	)
});

// By the file name shown on the row, not by any text that mentions it.
const row = (page: Page, name: string) =>
	page.locator('.batch__item').filter({ has: page.getByText(name, { exact: true }) });

test('several files are previewed and imported together, JSON and Markdown mixed', async ({
	page
}) => {
	await page.goto('/import');
	await page
		.locator('input[type=file]')
		.setInputFiles([
			json('bulk-a.json', 'bulk-a', 'Bulk A', 3),
			markdown('bulk-b.md', 'bulk-b', 'Bulk B')
		]);

	await expect(page.getByRole('heading', { name: '2 files' })).toBeVisible();
	await expect(row(page, 'bulk-a.json')).toContainText('Not previewed');
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);

	await page.getByRole('button', { name: 'Preview all' }).click();
	await expect(row(page, 'bulk-a.json')).toContainText('Bulk A');
	await expect(row(page, 'bulk-a.json')).toContainText('Ready');
	await expect(row(page, 'bulk-b.md')).toContainText('Bulk B');
	await expect(row(page, 'bulk-b.md')).toContainText('Ready');

	await page.getByRole('button', { name: 'Import 2 decks' }).click();
	await expect(row(page, 'bulk-a.json')).toContainText('Imported');
	await expect(row(page, 'bulk-a.json')).toContainText('3 new');
	await expect(row(page, 'bulk-b.md')).toContainText('Imported');

	await row(page, 'bulk-a.json').getByRole('link', { name: 'Study' }).click();
	await expect(page).toHaveURL(/\/study\/bulk-a$/);
});

test('a bad file is reported on its own line and the good one still imports', async ({ page }) => {
	await page.goto('/import');
	await page.locator('input[type=file]').setInputFiles([
		json('mixed-good.json', 'mixed-good', 'Mixed good'),
		{
			name: 'mixed-bad.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{ "tessera": 1, "deck": ', 'utf8')
		}
	]);
	await page.getByRole('button', { name: 'Preview all' }).click();

	await expect(row(page, 'mixed-bad.json')).toContainText('Problem');
	await expect(row(page, 'mixed-good.json')).toContainText('Ready');

	await page.getByRole('button', { name: 'Import 1 deck' }).click();
	await expect(row(page, 'mixed-good.json')).toContainText('Imported');
	await expect(row(page, 'mixed-bad.json')).toContainText('Problem');
});

test('two files with the same deck id are caught before anything is imported', async ({ page }) => {
	await page.goto('/import');
	await page
		.locator('input[type=file]')
		.setInputFiles([
			json('twin-1.json', 'twin-deck', 'Twin one'),
			json('twin-2.json', 'twin-deck', 'Twin two')
		]);
	await page.getByRole('button', { name: 'Preview all' }).click();

	await expect(row(page, 'twin-1.json')).toContainText('Ready');
	await expect(row(page, 'twin-2.json')).toContainText('already used by twin-1.json');

	// Removing the first file frees the id, so the second goes ahead.
	await page.getByRole('button', { name: 'Remove twin-1.json' }).click();
	await expect(row(page, 'twin-2.json')).toContainText('Ready');
});

test('files that are not decks are skipped with a message', async ({ page }) => {
	await page.goto('/import');
	await page
		.locator('input[type=file]')
		.setInputFiles([
			json('kept-1.json', 'kept-1', 'Kept 1'),
			json('kept-2.json', 'kept-2', 'Kept 2'),
			{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
		]);
	await expect(page.getByRole('heading', { name: '2 files' })).toBeVisible();
	await expect(page.getByRole('status')).toContainText('photo.png');
});

test('one file still goes into the paste box, and "Clear all" returns to it', async ({ page }) => {
	await page.goto('/import');
	await page.locator('input[type=file]').setInputFiles(json('solo.json', 'solo', 'Solo'));
	await expect(page.getByLabel('Deck (JSON or Markdown)')).not.toHaveValue('');
	await expect(page.locator('.batch')).toHaveCount(0);

	await page
		.locator('input[type=file]')
		.setInputFiles([json('p-1.json', 'p-1', 'P1'), json('p-2.json', 'p-2', 'P2')]);
	await expect(page.locator('.batch')).toBeVisible();
	await page.getByRole('button', { name: 'Clear all' }).click();
	await expect(page.getByLabel('Deck (JSON or Markdown)')).toBeVisible();
});
