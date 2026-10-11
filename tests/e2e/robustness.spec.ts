import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Exploratory checks for things real decks and real networks do: hostile layout, a lost connection,
// two tabs, a held-down key, an unknown deck, and odd files.

const WIDE_CODE =
	'```text\n' +
	'interface GigabitEthernet0/0/0 ip address 10.10.10.10 255.255.255.0 '.repeat(6) +
	'\n```';
const WIDE_TABLE =
	'| ' +
	Array.from({ length: 14 }, (_, i) => `column-number-${i}`).join(' | ') +
	' |\n|' +
	'---|'.repeat(14) +
	'\n| ' +
	Array.from({ length: 14 }, (_, i) => `value-${i}-with-some-text`).join(' | ') +
	' |';
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(8);
const LONG_URL = `[${'https://example.com/a/very/long/path/'.repeat(8)}](https://example.com/${'segment/'.repeat(30)})`;
const MIXED_SCRIPTS =
	'日本語のテキストと한국어 텍스트, العربية من اليمين إلى اليسار, עברית, emoji 👨‍👩‍👧‍👦🏳️‍🌈 and Zalgo z̷̢̛͓a̴l̶g̷o̸';
// Just under the 20,000 character field limit.
const HUGE = Array.from(
	{ length: 160 },
	(_, i) => `Paragraph ${i + 1}. ` + 'lorem ipsum '.repeat(10)
)
	.join('\n\n')
	.slice(0, 19_990);

async function currentCounts(
	page: Page
): Promise<{ new: number; learning: number; review: number }> {
	const response = await page.request.get('/api/decks');
	const body = (await response.json()) as {
		totals: { new: number; learning: number; review: number };
	};
	return body.totals;
}

test.describe('hostile content does not break the layout or the controls', () => {
	// Studying grades cards, so every test gets a deck of its own.
	const hostileDeck = (id: string, title = 'Hostile layout') =>
		deckOf(id, title, [
			{ id: 'wide-code', type: 'basic', front: `Wide code\n\n${WIDE_CODE}`, back: WIDE_CODE },
			{ id: 'wide-table', type: 'basic', front: `Wide table\n\n${WIDE_TABLE}`, back: WIDE_TABLE },
			{
				id: 'long-word',
				type: 'basic',
				front: `Long word ${LONG_WORD}`,
				back: `${LONG_WORD}\n\n${LONG_URL}`
			},
			{ id: 'scripts', type: 'basic', front: MIXED_SCRIPTS, back: MIXED_SCRIPTS },
			{ id: 'huge', type: 'basic', front: HUGE, back: HUGE }
		]);

	for (const width of [320, 768]) {
		test(`study page at ${width}px`, async ({ page, request }) => {
			await importViaApi(request, hostileDeck(`hostile-${width}`));
			await page.setViewportSize({ width, height: 700 });
			await page.goto(`/study/hostile-${width}`);
			for (let i = 0; i < 5; i++) {
				await expect(page.locator('.card')).toBeVisible();
				expect(await scrollsHorizontally(page), `card ${i + 1} front`).toBe(false);
				await page.keyboard.press('Space');
				await expect(page.getByRole('group', { name: /How well/ })).toBeVisible();
				expect(await scrollsHorizontally(page), `card ${i + 1} back`).toBe(false);
				// The grade buttons must be reachable even after a very long card.
				await page.getByRole('button', { name: /Good/ }).scrollIntoViewIfNeeded();
				await expect(page.getByRole('button', { name: /Good/ })).toBeInViewport();
				await page.keyboard.press('4');
			}
		});
	}

	test('wide code and tables scroll inside the card, not the page', async ({ page, request }) => {
		await importViaApi(request, hostileDeck('hostile-scroll'));
		await page.setViewportSize({ width: 320, height: 700 });
		await page.goto('/study/hostile-scroll');
		// Cards are served in position order for new cards: the first is the wide code block.
		await expect(page.locator('.card__front')).toContainText('Wide code');
		const box = await page
			.locator('.card__front pre')
			.first()
			.evaluate((el) => ({
				scrolls: el.scrollWidth > el.clientWidth,
				fits: el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1
			}));
		expect(box.scrolls, 'the code block scrolls sideways inside itself').toBe(true);
		expect(box.fits, 'the code block stays inside the viewport').toBe(true);
	});

	test('the home page copes with a 200 character deck title', async ({ page, request }) => {
		await importViaApi(request, hostileDeck('hostile-title', 'L'.repeat(200)));
		await page.setViewportSize({ width: 320, height: 700 });
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'L'.repeat(200) })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		await page.setViewportSize({ width: 1280, height: 800 });
		expect(await scrollsHorizontally(page)).toBe(false);
	});

	test('mixed scripts and emoji render intact', async ({ page, request }) => {
		await importViaApi(request, hostileDeck('hostile-scripts'));
		await page.goto('/study/hostile-scripts');
		for (let i = 0; i < 3; i++) {
			await expect(page.locator('.card')).toBeVisible();
			await page.keyboard.press('Space');
			await page.keyboard.press('4');
		}
		await expect(page.locator('.card__front')).toContainText('日本語のテキスト');
		await expect(page.locator('.card__front')).toContainText('👨‍👩‍👧‍👦');
	});
});

test.describe('failure handling in the study screen', () => {
	test('a lost connection keeps the answer and the retry records it once', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('flaky', 'Flaky', basicCards(3, 'fl')));
		const before = (await currentCounts(page)).new;

		let attempts = 0;
		await page.route('**/api/study/review', (route) => {
			attempts++;
			return attempts === 1 ? route.abort('connectionfailed') : route.continue();
		});

		await page.goto('/study/flaky');
		await expect(page.locator('.card__front')).toContainText('Question 1');
		await page.keyboard.press('Space');
		await page.keyboard.press('4');

		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('alert')).toContainText(
			/reach the Tessera server|could not be saved/i
		);
		await page.getByRole('button', { name: 'Try again' }).click();

		await expect(page.locator('.card__front')).toContainText('Question 2');
		expect(attempts).toBe(2);
		expect((await currentCounts(page)).new).toBe(before - 1);
	});

	test('a response that is lost after the server saved it is not double counted', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('lost-reply', 'Lost reply', basicCards(3, 'lr')));
		const before = (await currentCounts(page)).new;

		let attempts = 0;
		await page.route('**/api/study/review', async (route) => {
			attempts++;
			if (attempts === 1) {
				// The server records the grade, then the reply never reaches the browser.
				await route.fetch();
				return route.abort('connectionreset');
			}
			return route.continue();
		});

		await page.goto('/study/lost-reply');
		await expect(page.locator('.card__front')).toContainText('Question 1');
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
		await expect(page.getByRole('alert')).toBeVisible();
		await page.getByRole('button', { name: 'Try again' }).click();

		await expect(page.locator('.card__front')).toContainText('Question 2');
		expect((await currentCounts(page)).new, 'recorded exactly once').toBe(before - 1);
	});

	test('a card answered in another tab is skipped with a notice', async ({ browser, request }) => {
		await importViaApi(request, deckOf('two-tabs', 'Two tabs', basicCards(4, 'tt')));
		const context = await browser.newContext();
		const first = await context.newPage();
		const second = await context.newPage();
		await first.goto('http://127.0.0.1:4177/study/two-tabs');
		await second.goto('http://127.0.0.1:4177/study/two-tabs');
		await expect(first.locator('.card__front')).toContainText('Question 1');
		await expect(second.locator('.card__front')).toContainText('Question 1');

		await first.keyboard.press('Space');
		await first.keyboard.press('4');
		await expect(first.locator('.card__front')).toContainText('Question 2');

		await second.keyboard.press('Space');
		await second.keyboard.press('4');
		await expect(second.getByRole('status').filter({ hasText: 'already answered' })).toBeVisible();
		await expect(second.locator('.card__front')).toContainText('Question 2');
		await context.close();
	});

	test('two grade keys in the same instant record one grade and show no false notice', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('double-tap', 'Double tap', basicCards(4, 'dt')));
		const before = (await currentCounts(page)).new;
		await page.goto('/study/double-tap');
		await expect(page.locator('.card__front')).toContainText('Question 1');
		await page.keyboard.press('Space');
		await expect(page.getByRole('group', { name: /How well/ })).toBeVisible();

		// Both events fire in one task, before the first request can finish. Real key events always
		// target an element, so these go to the focused element, not to window.
		await page.evaluate(() => {
			const target = document.activeElement ?? document.body;
			for (let i = 0; i < 2; i++) {
				target.dispatchEvent(
					new KeyboardEvent('keydown', { key: '4', bubbles: true, cancelable: true })
				);
			}
		});

		await expect(page.locator('.card__front')).toContainText('Question 2');
		await expect(page.getByText('already answered')).toBeHidden();
		expect((await currentCounts(page)).new).toBe(before - 1);
	});

	test('reloading mid-session loses nothing', async ({ page, request }) => {
		await importViaApi(request, deckOf('reload', 'Reload', basicCards(3, 'rl')));
		await page.goto('/study/reload');
		await expect(page.locator('.card__front')).toContainText('Question 1');
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
		await expect(page.locator('.card__front')).toContainText('Question 2');
		await page.reload();
		await expect(page.locator('.card__front')).toContainText('Question 2');
	});

	test('an unknown deck gives a clear message instead of a blank page', async ({ page }) => {
		await page.goto('/study/no-such-deck');
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('alert')).not.toBeEmpty();
		await expect(page.getByRole('link', { name: /Decks/ }).first()).toBeVisible();
	});

	test('a malformed deck id in the address is handled', async ({ page }) => {
		const response = await page.goto('/study/' + encodeURIComponent('../../etc/passwd'));
		expect(response?.status()).toBeLessThan(500);
		await expect(page.locator('main')).toBeVisible();
	});

	test('the home page recovers when the server was briefly unreachable', async ({ page }) => {
		let attempts = 0;
		await page.route('**/api/decks', (route) => {
			attempts++;
			return attempts === 1 ? route.abort('connectionfailed') : route.continue();
		});
		await page.goto('/');
		await expect(page.getByRole('alert')).toBeVisible();
		await page.getByRole('button', { name: 'Try again' }).click();
		await expect(page.getByRole('alert')).toBeHidden();
		await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
	});
});

test.describe('import files', () => {
	test('a deck file with a byte order mark and Windows line endings imports', async ({ page }) => {
		const deck = JSON.stringify(
			deckOf('bom-deck', 'BOM deck', basicCards(2, 'bm')),
			null,
			2
		).replace(/\n/g, '\r\n');
		await page.goto('/import');
		await page.locator('input[type=file]').setInputFiles({
			name: 'deck.json',
			mimeType: 'application/json',
			buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(deck, 'utf8')])
		});
		await expect(page.locator('.field')).not.toHaveValue('');
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.getByRole('heading', { name: /BOM deck/ })).toBeVisible();
	});

	test('a file over 5 MB is refused with a clear message', async ({ page }) => {
		await page.goto('/import');
		await page.locator('input[type=file]').setInputFiles({
			name: 'big.json',
			mimeType: 'application/json',
			buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)
		});
		await expect(page.getByText('larger than the 5 MB limit')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Preview' })).toBeDisabled();
	});

	test('a binary file gives an error list, not a crash', async ({ page }) => {
		await page.goto('/import');
		await page.locator('input[type=file]').setInputFiles({
			name: 'photo.json',
			mimeType: 'application/json',
			buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x00])
		});
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled();
	});

	test('a server error during import shows a message and leaves the text in place', async ({
		page
	}) => {
		await page.route('**/api/import**', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: '{"error":{"code":"internal_error","message":"Something went wrong on the server."}}'
			})
		);
		await page.goto('/import');
		const text = JSON.stringify(deckOf('err-deck', 'Err', basicCards(1)));
		await page.getByLabel('Deck (JSON)').fill(text);
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.getByRole('alert')).toContainText('Something went wrong');
		await expect(page.getByLabel('Deck (JSON)')).toHaveValue(text);
	});
});
