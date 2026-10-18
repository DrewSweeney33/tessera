import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// Undo the last answer (ADR-019), in study and in practice. Every deck has its own id because the specs share one
// server.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

interface DeckRow {
	id: string;
	counts: { new: number; learning: number; review: number };
}

async function deckCounts(request: APIRequestContext, id: string) {
	const response = await request.get('/api/decks');
	return ((await response.json()) as { decks: DeckRow[] }).decks.find((deck) => deck.id === id)!
		.counts;
}

async function practicedAnswers(request: APIRequestContext, deckId: string): Promise<number> {
	const response = await request.get(`/api/stats?deckId=${deckId}`);
	return ((await response.json()) as { practicedToday: { answers: number } }).practicedToday
		.answers;
}

async function answerGood(page: Page) {
	await page.getByRole('button', { name: /Show answer/ }).click();
	await page.getByRole('button', { name: /Good/ }).click();
}

test.describe('undo in study', () => {
	test('takes the last answer back with the button and shows the card again', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-undo-1', 'Undo one', basicCards(3, 'u1')));
		await page.goto('/study/e2e-undo-1');
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Take back your last answer' })).toHaveCount(0);

		await answerGood(page);
		await expect(page.getByText('Question 2')).toBeVisible();
		await expect(page.getByText(/New\s*2/)).toBeVisible();
		await expect.poll(async () => (await deckCounts(request, 'e2e-undo-1')).new).toBe(2);

		await page.getByRole('button', { name: 'Take back your last answer' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Took back your Good' })).toBeVisible();
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect(page.getByText(/New\s*3/)).toBeVisible();
		expect(await deckCounts(request, 'e2e-undo-1')).toEqual({ new: 3, learning: 0, review: 0 });
		// One step only: the button is gone until another answer is given.
		await expect(page.getByRole('button', { name: 'Take back your last answer' })).toHaveCount(0);

		// The card can be answered again, and is saved as a fresh answer.
		await answerGood(page);
		await expect(page.getByText('Question 2')).toBeVisible();
		await expect.poll(async () => (await deckCounts(request, 'e2e-undo-1')).new).toBe(2);
	});

	test('works from the keyboard with U and with Ctrl+Z', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-undo-2', 'Undo two', basicCards(2, 'u2')));
		await page.goto('/study/e2e-undo-2');
		await expect(page.getByText('Question 1')).toBeVisible();
		await page.keyboard.press('Space');
		await page.keyboard.press('3');
		await expect(page.getByText('Question 2')).toBeVisible();

		await page.keyboard.press('u');
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect.poll(async () => (await deckCounts(request, 'e2e-undo-2')).new).toBe(2);

		await page.keyboard.press('Space');
		await page.keyboard.press('3');
		await expect(page.getByText('Question 2')).toBeVisible();
		await page.keyboard.press('Control+z');
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect.poll(async () => (await deckCounts(request, 'e2e-undo-2')).new).toBe(2);
	});

	test('U is a letter, not a command, while typing an answer', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-undo-2b', 'Undo two b', [
				{ id: 't1', type: 'typed', front: 'Type one', answer: 'abc' },
				{ id: 't2', type: 'typed', front: 'Type two', answer: 'abc' }
			])
		);
		await page.goto('/study/e2e-undo-2b');
		const box = page.getByRole('textbox');
		await expect(box).toBeFocused();
		await box.fill('abc');
		await page.keyboard.press('Enter');
		await page.keyboard.press('3');
		await expect(page.getByText('Type two')).toBeVisible();
		await expect(box).toBeFocused();
		await page.keyboard.press('u');
		await expect(box).toHaveValue('u');
		await expect(page.getByText('Type two')).toBeVisible();
		await expect(page.getByText('Type one')).toHaveCount(0);
	});

	test('can take back the answer that finished the session', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-undo-3', 'Undo three', basicCards(1, 'u3')));
		await page.goto('/study/e2e-undo-3');
		// Easy on a new card sends it days away, so the session is finished.
		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.getByRole('button', { name: /Easy/ }).click();
		await expect(page.getByRole('heading', { name: /Session complete/ })).toBeVisible();
		await page.getByRole('button', { name: /Take back the last answer/ }).click();
		await expect(page.getByText('Question 1')).toBeVisible();
		expect(await deckCounts(request, 'e2e-undo-3')).toEqual({ new: 1, learning: 0, review: 0 });
	});

	test('says so when the answer can no longer be taken back (another tab answered)', async ({
		page,
		browser,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-undo-4', 'Undo four', basicCards(3, 'u4')));
		await page.goto('/study/e2e-undo-4');
		await answerGood(page);
		await expect(page.getByText('Question 2')).toBeVisible();

		// A second tab answers a card, so the first tab's answer is no longer the newest.
		const other = await browser.newPage();
		await other.goto('/study/e2e-undo-4');
		await other.getByRole('button', { name: /Show answer/ }).click();
		await other.getByRole('button', { name: /Good/ }).click();
		await expect(other.getByText('Question 3')).toBeVisible();
		await other.close();

		await page.getByRole('button', { name: 'Take back your last answer' }).click();
		await expect(
			page.getByRole('status').filter({ hasText: 'That answer can no longer be taken back' })
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Take back your last answer' })).toHaveCount(0);
	});
});

test.describe('undo in practice', () => {
	test('takes the last practice answer back and leaves the schedule alone', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-undo-5', 'Undo five', basicCards(3, 'u5')));
		await page.goto('/practice?deck=e2e-undo-5');
		await page.getByRole('button', { name: 'Start practice' }).click();
		await expect(page.getByText(/Question \d/)).toBeVisible();
		const first = (await page
			.getByText(/Question \d/)
			.first()
			.textContent())!.trim();

		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect.poll(() => practicedAnswers(request, 'e2e-undo-5')).toBe(1);
		await expect(page.getByText(first, { exact: true })).toHaveCount(0);

		await page.getByRole('button', { name: 'Take back your last answer' }).click();
		await expect(page.getByText(first, { exact: true })).toBeVisible();
		await expect.poll(() => practicedAnswers(request, 'e2e-undo-5')).toBe(0);
		expect(await deckCounts(request, 'e2e-undo-5')).toEqual({ new: 3, learning: 0, review: 0 });
		await expect(page.getByRole('button', { name: 'Take back your last answer' })).toHaveCount(0);
	});

	test('can take back the last answer of a finished session and goes on from there', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-undo-6', 'Undo six', basicCards(1, 'u6')));
		await page.goto('/practice?deck=e2e-undo-6');
		await page.getByRole('button', { name: 'Start practice' }).click();
		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
		await page.getByRole('button', { name: /Take back the last answer/ }).click();
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect.poll(() => practicedAnswers(request, 'e2e-undo-6')).toBe(0);
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('the study screen with the Undo button passes the accessibility scan', async ({
			page,
			request
		}) => {
			await importViaApi(
				request,
				deckOf(`e2e-undo-a11y-${scheme}`, `Undo a11y ${scheme}`, basicCards(2, 'ua'))
			);
			await page.goto(`/study/e2e-undo-a11y-${scheme}`);
			await answerGood(page);
			await expect(page.getByRole('button', { name: 'Take back your last answer' })).toBeVisible();
			await page.evaluate(() =>
				Promise.all(
					document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
				)
			);
			const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		});
	});
}

test.describe('on a phone', () => {
	test('the Undo button is a full-size touch target inside the first screen at 320px', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-undo-7', 'Undo seven', basicCards(2, 'u7')));
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/study/e2e-undo-7');
		await answerGood(page);
		const undo = page.getByRole('button', { name: 'Take back your last answer' });
		await expect(undo).toBeVisible();
		const box = (await undo.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(43.5);
		expect(box.y + box.height).toBeLessThanOrEqual(568);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth
			)
		).toBe(false);
	});
});
