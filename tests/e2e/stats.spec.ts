import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// The Statistics page (ADR-017): numbers for every deck, one folder, or one deck, with charts drawn in SVG. Each test
// has its own decks because the specs share one server, and removes the folders it made.

const JSON_HEADERS = { 'content-type': 'application/json' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// Answers the next cards of a deck through the API, as a study session would.
async function study(request: APIRequestContext, deckId: string, grades: (1 | 2 | 3 | 4)[]) {
	for (const grade of grades) {
		const next = (await (await request.get(`/api/study/next?deckId=${deckId}`)).json()) as {
			done: boolean;
			item?: { cardPk: number; ordinal: number; servedAt: string };
		};
		if (next.done || !next.item) throw new Error(`nothing left to study in ${deckId}`);
		const response = await request.post('/api/study/review', {
			headers: JSON_HEADERS,
			data: JSON.stringify({
				reviewId: crypto.randomUUID(),
				cardPk: next.item.cardPk,
				ordinal: next.item.ordinal,
				grade,
				servedAt: next.item.servedAt,
				durationMs: 3000
			})
		});
		expect(response.ok(), await response.text()).toBe(true);
	}
}

async function practice(request: APIRequestContext, deckId: string, answers: boolean[]) {
	const started = (await (
		await request.post('/api/practice/start', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ deckId, count: 'all', order: 'weakest' })
		})
	).json()) as { items: { cardPk: number; ordinal: number }[] };
	for (const [index, right] of answers.entries()) {
		const item = started.items[index % started.items.length]!;
		const response = await request.post('/api/practice/grade', {
			headers: JSON_HEADERS,
			data: JSON.stringify({
				reviewId: crypto.randomUUID(),
				cardPk: item.cardPk,
				ordinal: item.ordinal,
				right,
				durationMs: 1000
			})
		});
		expect(response.ok(), await response.text()).toBe(true);
	}
}

test.afterEach(async ({ request }) => {
	const response = await request.get('/api/folders');
	for (const folder of ((await response.json()) as { folders: { id: number }[] }).folders) {
		await request.delete(`/api/folders/${folder.id}`, { headers: JSON_HEADERS });
	}
});

async function scan(page: Page, label: string) {
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const summary = results.violations.map(
		(violation) =>
			`${violation.id} (${violation.impact}): ${violation.help}\n    ` +
			violation.nodes
				.slice(0, 3)
				.map((node) => node.target.join(' '))
				.join('\n    ')
	);
	expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

const tile = (page: Page, name: string) => page.locator('.tile', { hasText: name });
const pick = (page: Page, label: string) =>
	page.getByLabel('Show', { exact: true }).selectOption({ label });

test.describe('reaching the page', () => {
	test('has a Stats tab in the navigation', async ({ page }) => {
		await page.goto('/');
		await page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Stats' })
			.click();
		await expect(page).toHaveURL(/\/stats$/);
		await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
		await expect(
			page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' })
		).toHaveAttribute('aria-current', 'page');
	});

	test('shows every deck at first, with all the sections', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-all', 'E2E stats all', basicCards(3, 'a')));
		await page.goto('/stats');
		await expect(page.locator('.summary strong')).toHaveText('All decks');
		for (const heading of [
			'Reviews, last 14 days',
			'Coming due, next 30 days',
			'The last 26 weeks',
			'Recall by tag'
		]) {
			await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
		}
		await expect(tile(page, 'Reviews today')).toBeVisible();
		await expect(tile(page, 'Streak')).toBeVisible();
	});
});

test.describe('a deck', () => {
	test('counts the reviews of its own study and nothing else', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-deck', 'E2E stats deck', basicCards(4, 'd')));
		await importViaApi(request, deckOf('e2e-st-other', 'E2E stats other', basicCards(2, 'o')));
		await study(request, 'e2e-st-deck', [3, 3, 1]);
		await study(request, 'e2e-st-other', [3]);

		await page.goto('/stats');
		await pick(page, 'E2E stats deck');
		await expect(page).toHaveURL(/\/stats\?deck=e2e-st-deck$/);
		await expect(page.locator('.summary strong')).toHaveText('E2E stats deck');
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('3');
		await expect(tile(page, 'Last 7 days').locator('dd').first()).toHaveText('3');
		await expect(tile(page, 'Streak').locator('dd').first()).toHaveText('1');
		await expect(page.getByText('4 cards in 1 deck.')).toBeVisible();
		// 3 reviews of 3 seconds each.
		await expect(tile(page, 'Reviews today')).toContainText('9 s');

		await pick(page, 'E2E stats other');
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('1');
	});

	test('says so when a deck has no reviews yet', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-fresh', 'E2E stats fresh', basicCards(2, 'f')));
		await page.goto('/stats?deck=e2e-st-fresh');
		await expect(page.getByText('No reviews yet for E2E stats fresh.')).toBeVisible();
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('0');
		await expect(tile(page, 'Recalled, 30 days').locator('dd').first()).toHaveText('No data');
	});

	test('shows the forecast and the heatmap as accessible tables', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-charts', 'E2E stats charts', basicCards(3, 'c')));
		await study(request, 'e2e-st-charts', [3, 3]);
		await page.goto('/stats?deck=e2e-st-charts');
		await expect(
			page.getByRole('img', { name: /Reviews per study day, last 14 days/ })
		).toBeVisible();
		await expect(
			page.getByRole('img', { name: /Items due per study day, next 30 days/ })
		).toBeVisible();
		await expect(
			page.getByRole('img', { name: /Reviews per study day, last 26 weeks. 2 reviews on 1 day/ })
		).toBeVisible();
		// The same numbers as text, for a screen reader: two reviews today in the last-14-days table.
		const lastRow = page.locator('table', { hasText: 'last 14 days' }).locator('tbody tr').last();
		await expect(lastRow.locator('td')).toHaveText('2');
		// Studied cards are now due in the days ahead, so the forecast has items.
		const forecast = page.locator('table', { hasText: 'next 30 days' });
		await expect(forecast.locator('tbody tr')).toHaveCount(30);
	});
});

test.describe('a folder', () => {
	test('adds up the decks in it', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-fa', 'E2E stats fa', basicCards(3, 'a')));
		await importViaApi(request, deckOf('e2e-st-fb', 'E2E stats fb', basicCards(3, 'b')));
		await importViaApi(request, deckOf('e2e-st-fc', 'E2E stats fc', basicCards(3, 'c')));
		const made = await request.post('/api/folders', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ name: 'E2E stats folder' })
		});
		const folderId = ((await made.json()) as { folder: { id: number } }).folder.id;
		await request.put('/api/folder-assignments', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ deckIds: ['e2e-st-fa', 'e2e-st-fb'], folderId })
		});
		await study(request, 'e2e-st-fa', [3, 3]);
		await study(request, 'e2e-st-fb', [3]);
		await study(request, 'e2e-st-fc', [3, 3, 3]);

		await page.goto('/stats');
		await pick(page, 'E2E stats folder');
		await expect(page).toHaveURL(new RegExp(`/stats\\?folder=${folderId}$`));
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('3');
		await expect(page.getByText('6 cards in 2 decks.')).toBeVisible();
	});
});

test.describe('practice', () => {
	test('is shown on its own line and is not counted in the numbers', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-prac', 'E2E stats prac', basicCards(3, 'p')));
		await study(request, 'e2e-st-prac', [3]);
		await page.goto('/stats?deck=e2e-st-prac');
		await expect(page.getByText('No practice today.')).toBeVisible();
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('1');

		await practice(request, 'e2e-st-prac', [true, false, true, true]);
		await page.reload();
		await expect(page.getByText(/Practiced today:\s*3 cards\s+in\s+4 answers/)).toBeVisible();
		await expect(tile(page, 'Reviews today').locator('dd').first()).toHaveText('1');
		await expect(tile(page, 'Last 30 days').locator('dd').first()).toHaveText('1');
		await expect(tile(page, 'Streak').locator('dd').first()).toHaveText('1');
	});
});

test.describe('remembering the choice', () => {
	test('comes back to the last scope when the page is opened again', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-mem', 'E2E stats mem', basicCards(2, 'm')));
		await page.goto('/stats');
		await pick(page, 'E2E stats mem');
		await expect(page).toHaveURL(/deck=e2e-st-mem/);
		await page.goto('/stats');
		await expect(page.getByLabel('Show', { exact: true })).toHaveValue('deck:e2e-st-mem');
		await expect(page.getByText('2 cards in 1 deck.')).toBeVisible();
	});

	test('falls back to every deck when the remembered deck is gone', async ({ page }) => {
		await page.goto('/stats?deck=e2e-st-no-such-deck');
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(page.getByLabel('Show', { exact: true })).toHaveValue('');
		await expect(page.getByRole('heading', { name: 'Reviews, last 14 days' })).toBeVisible();
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('the Statistics page passes the accessibility scan', async ({ page, request }) => {
			const id = `e2e-st-a11y-${scheme}`;
			await importViaApi(
				request,
				deckOf(id, `E2E stats a11y ${scheme}`, [
					...basicCards(5, 'x').map((card) => ({ ...card, tags: ['net'] }))
				])
			);
			await study(request, id, [3, 3, 3, 1, 3, 3]);
			await practice(request, id, [true, false]);
			await page.goto('/stats');
			await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
			await scan(page, 'every deck');
			await pick(page, `E2E stats a11y ${scheme}`);
			await expect(page.getByText('Practiced today:')).toBeVisible();
			await scan(page, 'one deck with reviews and practice');
		});
	});
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test('does not scroll sideways, and the charts fit', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-st-phone', 'E2E stats phone', basicCards(3, 'q')));
		await study(request, 'e2e-st-phone', [3, 3]);
		await page.goto('/stats?deck=e2e-st-phone');
		await expect(page.getByRole('heading', { name: 'The last 26 weeks' })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		// The tab bar has five tabs now and each one still fits and is reachable.
		const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
		await expect(tabs).toHaveCount(await tabs.count());
		for (const name of ['Decks', 'Import', 'Stats', 'Leeches', 'Settings']) {
			await expect(
				page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })
			).toBeVisible();
		}
	});
});
