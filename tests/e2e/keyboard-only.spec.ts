import { expect, test, type Page } from '@playwright/test';

// A whole session with no mouse: import a Markdown deck with all four card types, then study every card.
// Nothing here clicks. Focus moves with Tab, and everything else is a key press or typed text.

const DECK = [
	'---',
	'tessera: 1',
	'id: keyboard-only',
	'title: Keyboard only',
	'---',
	'',
	'## kb-basic',
	'Q: What is the default OSPF hello interval on broadcast networks?',
	'A: 10 seconds',
	'',
	'## kb-cloze',
	'Cloze: The {{c1::DR}} is elected by highest {{c2::priority}}.',
	'',
	'## kb-typed',
	'Q: Command to list OSPF neighbors?',
	'Answer: show ip ospf neighbor',
	'Accept: sh ip ospf nei',
	'',
	'## kb-choice',
	'Q: Which LSA type describes a network segment?',
	'Choices:',
	'- Type 1',
	'- [x] Type 2',
	'- Type 3',
	'- Type 5',
	'Explanation: The DR originates Type 2.',
	''
].join('\n');

// Presses Tab until the focused element satisfies the test, and fails if it takes more than `max` presses.
// The test runs in the page, so it cannot use variables from here. Anything it needs is passed as `arg`.
async function tabTo(
	page: Page,
	describe: string,
	matches: (el: Element, arg: string) => boolean,
	arg = '',
	max = 25
) {
	for (let i = 0; i < max; i++) {
		const found = await page.evaluate(
			`(${matches.toString()})(document.activeElement, ${JSON.stringify(arg)})`
		);
		if (found) return;
		await page.keyboard.press('Tab');
	}
	throw new Error(`Tab never reached ${describe} within ${max} presses`);
}

const isButton = (name: string) => `Button "${name}"`;

// Safari does not Tab to links unless the person turns that on (they use Option+Tab), so in WebKit a link is
// focused directly and the rest of the journey, pressing Enter on it and what follows, is checked as usual.
async function reachLink(page: Page, name: string, browserName: string) {
	if (browserName === 'webkit') await page.getByRole('link', { name }).focus();
	else
		await tabTo(
			page,
			`the ${name} link`,
			(el, wanted) => el.tagName === 'A' && el.textContent?.trim() === wanted,
			name
		);
}

test('import a Markdown deck and study all four card types using only the keyboard', async ({
	page,
	browserName
}) => {
	await page.goto('/import');
	await expect(page.getByRole('heading', { name: 'Import a deck' })).toBeVisible();

	// Into the text box, and type the deck.
	await tabTo(page, 'the deck text box', (el) => el.id === 'deck-text');
	await page.keyboard.insertText(DECK);
	await expect(page.getByText('Reading this as Markdown.')).toBeVisible();

	// Preview, then Import, by Tab and Enter.
	await tabTo(
		page,
		isButton('Preview'),
		(el) => el.tagName === 'BUTTON' && el.textContent?.trim() === 'Preview'
	);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: /New deck: Keyboard only/ })).toBeVisible();
	await expect(page.locator('.tally')).toContainText('4');

	await tabTo(
		page,
		isButton('Import'),
		(el) => el.tagName === 'BUTTON' && el.textContent?.trim() === 'Import'
	);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();

	// Follow the "Study this deck" link, which is a link, so Enter follows it.
	await reachLink(page, 'Study this deck', browserName);
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/study\/keyboard-only$/);

	// Study every card. The queue order is not fixed, so each card is recognized by what is on it.
	const answered: string[] = [];
	for (let step = 0; step < 12; step++) {
		const card = page.locator('.card');
		const done = page.getByRole('heading', { name: 'Session complete' });
		await expect(card.or(done)).toBeVisible();
		if (await done.isVisible()) break;
		// The card just answered stays on screen, with its buttons disabled, until the next one arrives.
		await expect(page.getByRole('group', { name: /How well/ })).toBeHidden();
		if (await done.isVisible()) break;

		const front = (await page.locator('.card__front').innerText()).trim();
		if (/hello interval/.test(front)) {
			// Basic: Space to reveal, 4 for Easy.
			await page.keyboard.press('Space');
			await expect(page.locator('.card__back')).toContainText('10 seconds');
			answered.push('basic');
		} else if (/elected by highest/.test(front)) {
			// Cloze: Space to reveal.
			await page.keyboard.press('Space');
			await expect(page.locator('.card__back strong')).toBeVisible();
			answered.push('cloze');
		} else if (/list OSPF neighbors/.test(front)) {
			// Typed: the box has focus. Type the answer in a different case and press Enter. Good is suggested.
			await expect(page.getByLabel('Your answer')).toBeFocused();
			await page.keyboard.type('SHOW IP OSPF NEIGHBOR');
			await page.keyboard.press('Enter');
			await expect(page.locator('.result')).toHaveText('Your answer matches.');
			await expect(page.locator('.grade--3')).toBeFocused();
			answered.push('typed');
		} else {
			// Choice: press the number of the right option, wherever the shuffle put it.
			const index = await page
				.locator('.choices li')
				.evaluateAll((items) => items.findIndex((li) => li.textContent?.includes('Type 2')));
			expect(index).toBeGreaterThanOrEqual(0);
			await page.keyboard.press(String(index + 1));
			await expect(page.locator('.result')).toHaveText('Correct.');
			await expect(page.locator('.card__back')).toContainText('The DR originates Type 2.');
			answered.push('choice');
		}

		// Easy graduates the card, so each is studied once. On a typed or choice card this overrides the suggestion.
		await page.keyboard.press('4');
	}

	expect(answered.sort()).toEqual(['basic', 'choice', 'cloze', 'typed']);
	await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
	await expect(page.locator('.done')).toContainText('4 cards');

	// Back to the deck list with the keyboard.
	await reachLink(page, 'All decks', browserName);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Keyboard only' })).toBeVisible();
});

test('on a typed card the focus order is the answer box, then Check answer, then I don’t know', async ({
	page,
	request
}) => {
	// Fixed focus order: the answer box, then Check answer, then I don't know.
	await request.post('/api/import', {
		headers: { 'content-type': 'text/markdown' },
		data: '---\ntessera: 1\nid: kb-typed-order\ntitle: Typed order\n---\n\n## t\nQ: q?\nAnswer: yes\n'
	});
	await page.goto('/study/kb-typed-order');
	await expect(page.getByLabel('Your answer')).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: /Check answer/ })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'I don’t know' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('.result')).toHaveText('You did not type an answer.');
	await expect(page.locator('.grade--1')).toBeFocused();
});
