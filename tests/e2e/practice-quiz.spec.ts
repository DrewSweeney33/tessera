import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// Quiz me in Practice again (ADR-020): basic and typed cards shown as multiple choice, the wrong options taken from
// other cards' answers. Every deck has its own id because the specs share one server.

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

async function startQuiz(page: Page, deckId: string) {
	await page.goto(`/practice?deck=${deckId}`);
	await page.getByLabel('Quiz me: show cards as multiple choice').check();
	await page.getByRole('button', { name: 'Start practice' }).click();
}

// The number in "Question 3", to know which answer is the right one ("Answer 3").
async function questionNumber(page: Page): Promise<string> {
	const text = (await page.locator('.card__front').first().innerText()).trim();
	return /Question (\d+)/.exec(text)![1]!;
}

const options = (page: Page) => page.locator('.choice');

test.describe('Quiz me', () => {
	test('shows a basic card as four options with its own answer once, and counts a right pick as Got it', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-quiz-1', 'Quiz one', basicCards(6, 'q1')));
		const before = await deckCounts(request, 'e2e-quiz-1');
		await startQuiz(page, 'e2e-quiz-1');

		await expect(options(page)).toHaveCount(4);
		const number = await questionNumber(page);
		const texts = (await options(page).locator('.choice__text').allInnerTexts()).map((t) =>
			t.trim()
		);
		expect(new Set(texts).size).toBe(4);
		expect(texts.filter((text) => text === `Answer ${number}`)).toHaveLength(1);
		// The wrong options are other cards' answers.
		expect(texts.every((text) => /^Answer \d+$/.test(text))).toBe(true);

		await options(page)
			.filter({ hasText: `Answer ${number}` })
			.click();
		await expect(options(page).filter({ hasText: '✓ Right answer' })).toHaveCount(1);
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByText(/Question \d/)).toBeVisible();
		// Practice never touches the schedule.
		expect(await deckCounts(request, 'e2e-quiz-1')).toEqual(before);
	});

	test('a wrong pick is marked, suggests Missed it, and the card comes back', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-quiz-2', 'Quiz two', basicCards(5, 'q2')));
		await startQuiz(page, 'e2e-quiz-2');
		const first = await questionNumber(page);
		await options(page)
			.filter({ hasNotText: `Answer ${first}` })
			.first()
			.click();
		await expect(options(page).filter({ hasText: '✗ Your answer' })).toHaveCount(1);
		await expect(options(page).filter({ hasText: '✓ Right answer' })).toHaveCount(1);
		await expect(page.getByText(/Suggested:/)).toContainText('Missed it');
		await page.getByRole('button', { name: /Missed it/ }).click();

		// Answer everything else right; the missed card is asked again before the session ends.
		const seen: string[] = [first];
		const complete = page.getByRole('heading', { name: 'Practice complete' });
		// Enabled options belong to a card that is waiting for a pick; the old card's options stay on screen, disabled,
		// until the next one has loaded.
		const showFront = page.locator('.choice:enabled').first();
		for (let i = 0; i < 20; i++) {
			await expect(showFront.or(complete)).toBeVisible();
			if (await complete.isVisible()) break;
			const number = await questionNumber(page);
			seen.push(number);
			await options(page)
				.filter({ hasText: `Answer ${number}` })
				.click();
			await page.getByRole('button', { name: /Got it/ }).click();
		}
		await expect(complete).toBeVisible();
		expect(seen.filter((number) => number === first)).toHaveLength(2);
		expect(new Set(seen).size).toBe(5);
	});

	test('shows the same options in the same order after a reload and a resume', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-quiz-3', 'Quiz three', basicCards(6, 'q3')));
		await startQuiz(page, 'e2e-quiz-3');
		const number = await questionNumber(page);
		const order = await options(page).locator('.choice__text').allInnerTexts();
		await page.reload();
		await page.getByRole('button', { name: /Resume/ }).click();
		await expect(options(page)).toHaveCount(4);
		expect(await questionNumber(page)).toBe(number);
		expect(await options(page).locator('.choice__text').allInnerTexts()).toEqual(order);
	});

	test('shows a typed card as options too, with its answer among them', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-quiz-4', 'Quiz four', [
				{ id: 't1', type: 'typed', front: 'Command A', answer: 'show ip route' },
				{ id: 't2', type: 'typed', front: 'Command B', answer: 'show run' },
				{ id: 't3', type: 'typed', front: 'Command C', answer: 'show vlan' },
				{ id: 't4', type: 'typed', front: 'Command D', answer: 'show cdp neighbors' },
				{ id: 't5', type: 'typed', front: 'Command E', answer: 'show version' }
			])
		);
		await startQuiz(page, 'e2e-quiz-4');
		await expect(options(page)).toHaveCount(4);
		await expect(page.getByRole('textbox')).toHaveCount(0);
		const texts = (await options(page).locator('.choice__text').allInnerTexts()).map((t) =>
			t.trim()
		);
		expect(texts.every((text) => text.startsWith('show '))).toBe(true);
	});

	test('leaves a card that cannot be a question as it is', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-quiz-5', 'Quiz five', [
				{ id: 'c1', type: 'cloze', text: 'The {{c1::DR}} is elected on a broadcast network' }
			])
		);
		await startQuiz(page, 'e2e-quiz-5');
		await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible();
		await expect(options(page)).toHaveCount(0);
	});

	test('is off by default, and the checkbox explains itself when it is on', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-quiz-6', 'Quiz six', basicCards(5, 'q6')));
		await page.goto('/practice?deck=e2e-quiz-6');
		const box = page.getByLabel('Quiz me: show cards as multiple choice');
		await expect(box).not.toBeChecked();
		await expect(page.getByText(/Basic and typed cards become a question/)).toHaveCount(0);
		await box.check();
		await expect(page.getByText(/Basic and typed cards become a question/)).toBeVisible();
		await box.uncheck();
		await page.getByRole('button', { name: 'Start practice' }).click();
		await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible();
		await expect(options(page)).toHaveCount(0);
	});

	test('the option buttons are 44 px touch targets that fit at 320px', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-quiz-7', 'Quiz seven', basicCards(6, 'q7')));
		await page.setViewportSize({ width: 320, height: 568 });
		await startQuiz(page, 'e2e-quiz-7');
		await expect(options(page)).toHaveCount(4);
		for (const box of await options(page).evaluateAll((nodes) =>
			nodes.map((node) => node.getBoundingClientRect().height)
		)) {
			expect(box).toBeGreaterThanOrEqual(44);
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth
			)
		).toBe(false);
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('a quiz question passes the accessibility scan', async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf(`e2e-quiz-a11y-${scheme}`, `Quiz a11y ${scheme}`, basicCards(5, 'qa'))
			);
			await startQuiz(page, `e2e-quiz-a11y-${scheme}`);
			await expect(options(page)).toHaveCount(4);
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
