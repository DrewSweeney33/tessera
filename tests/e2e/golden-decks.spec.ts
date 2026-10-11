import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The example decks, imported the way a person would: through the import page, from a file, then studied. This
// is also the check that the diagrams and the code in them really are drawn and coloured in a browser.

const decks = [
	{ file: 'ccna-ospf.json', title: 'CCNA: OSPF', id: 'ccna-ospf-json', mime: 'application/json' },
	{ file: 'ccna-ospf.md', title: 'CCNA: OSPF', id: 'ccna-ospf-md', mime: 'text/markdown' },
	{
		file: 'powershell-essentials.md',
		title: 'PowerShell essentials',
		id: 'powershell-essentials',
		mime: 'text/markdown'
	},
	{
		file: 'tcp-ip-fundamentals.json',
		title: 'TCP/IP fundamentals',
		id: 'tcp-ip-fundamentals',
		mime: 'application/json'
	}
];

for (const deck of decks) {
	test(`${deck.file} imports from a file with no errors and can be studied`, async ({ page }) => {
		// The two CCNA files are the same deck, so the second one would update the first. Give each its own id
		// by changing only the deck id in the text that is sent.
		let text = readFileSync(`examples/${deck.file}`, 'utf8');
		if (deck.file.startsWith('ccna-ospf')) {
			text = text.replace(/ccna-ospf(?=["\n])/, deck.id);
		}

		await page.goto('/import');
		await page.locator('input[type=file]').setInputFiles({
			name: deck.file,
			mimeType: deck.mime,
			buffer: Buffer.from(text, 'utf8')
		});
		await expect(
			page.getByText(
				deck.file.endsWith('.md') ? 'Reading this as Markdown.' : 'Reading this as JSON.'
			)
		).toBeVisible();

		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.getByRole('heading', { name: `New deck: ${deck.title}` })).toBeVisible();
		await expect(page.locator('.problems')).toHaveCount(0);
		await expect(page.locator('.warning')).toHaveCount(0);

		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
		await page.getByRole('link', { name: 'Study this deck' }).click();
		await expect(page.locator('.card')).toBeVisible();
	});
}

import type { Page } from '@playwright/test';

// Studies a deck from the first card to the end of the session, giving up on every typed and choice card (which
// shows its answer), grading Easy so each card is done after one pass, and counting what rendered on each card.
async function studyThrough(page: Page, deckId: string) {
	const seen = { diagrams: 0, failedDiagrams: 0, codeBlocks: 0, cards: 0 };
	await page.goto(`/study/${deckId}`);
	for (let step = 0; step < 60; step++) {
		const card = page.locator('.card');
		const done = page.getByRole('heading', { name: /Session complete|Nothing to study/ });
		await expect(card.or(done)).toBeVisible();
		if (await done.isVisible()) break;
		seen.cards++;

		const count = async () => {
			await page.waitForTimeout(250);
			seen.diagrams += await card.locator('figure.diagram img').count();
			seen.failedDiagrams += await card.locator('.diagram-failed').count();
			seen.codeBlocks += await card.locator('code.shiki').count();
		};
		await count();

		const skip = page.getByRole('button', { name: 'I don’t know' });
		if (await skip.isVisible()) await skip.click();
		else await page.keyboard.press('Space');
		await expect(page.getByRole('group', { name: /How well/ })).toBeVisible();
		await count();
		await page.keyboard.press('4');
	}
	return seen;
}

test('the diagrams in the example decks are drawn and the code is coloured', async ({
	request,
	page
}) => {
	for (const file of ['tcp-ip-fundamentals.json', 'powershell-essentials.md']) {
		const response = await request.post('/api/import', {
			headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/markdown' },
			data: readFileSync(`examples/${file}`, 'utf8')
		});
		expect(response.ok(), await response.text()).toBe(true);
	}

	// Two cards of the TCP/IP deck have a sequence diagram on the front and another on the back.
	const tcp = await studyThrough(page, 'tcp-ip-fundamentals');
	expect(tcp.cards, 'cards studied').toBeGreaterThanOrEqual(14);
	expect(tcp.failedDiagrams, 'a diagram could not be drawn').toBe(0);
	expect(tcp.diagrams, 'diagram images across the deck').toBeGreaterThanOrEqual(4);

	// The PowerShell deck has code blocks in several cards.
	const powershell = await studyThrough(page, 'powershell-essentials');
	expect(powershell.cards, 'cards studied').toBeGreaterThanOrEqual(13);
	expect(powershell.codeBlocks, 'highlighted code blocks across the deck').toBeGreaterThanOrEqual(
		5
	);

	// The CCNA deck has a state diagram on the back of a card.
	const ccna = await studyThrough(page, 'ccna-ospf-json');
	expect(ccna.failedDiagrams, 'a diagram could not be drawn').toBe(0);
	expect(ccna.diagrams, 'diagram images across the deck').toBeGreaterThanOrEqual(1);
});
