import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Practice again (ADR-017): go through a deck or a folder again without touching the schedule. A missed card comes
// back until it has been answered right once. Every deck has its own id because the specs share one server, and
// every test removes the folders it made.

const JSON_HEADERS = { 'content-type': 'application/json' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

interface DeckRow {
	id: string;
	counts: { new: number; learning: number; review: number };
}

async function deckCounts(request: APIRequestContext, id: string) {
	const response = await request.get('/api/decks');
	const decks = ((await response.json()) as { decks: DeckRow[] }).decks;
	return decks.find((deck) => deck.id === id)!.counts;
}

async function makeFolder(request: APIRequestContext, name: string): Promise<number> {
	const response = await request.post('/api/folders', {
		headers: JSON_HEADERS,
		data: JSON.stringify({ name })
	});
	expect(response.status(), await response.text()).toBe(201);
	return ((await response.json()) as { folder: { id: number } }).folder.id;
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

const startPractice = (page: Page) => page.getByRole('button', { name: 'Start practice' }).click();
const showAnswer = (page: Page) => page.getByRole('button', { name: /Show answer/ }).click();

test.describe('practicing a deck', () => {
	test('loops a missed card back, finishes, and leaves the schedule alone', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-pr-loop', 'E2E practice loop', basicCards(3, 'p')));
		await page.goto('/');
		await page.getByRole('link', { name: 'Practice E2E practice loop again' }).click();

		await expect(page).toHaveURL(/\/practice\?deck=e2e-pr-loop$/);
		await expect(page.getByRole('heading', { name: 'Practice again', level: 1 })).toBeVisible();
		// The count choices include only sizes smaller than the pool, plus "All".
		await expect(page.getByLabel('All 3')).toBeChecked();
		await expect(page.getByLabel('20')).toHaveCount(0);
		await page.getByLabel('Weakest first').check();
		await expect(
			page.getByText('The cards you are least likely to remember come first.')
		).toBeVisible();
		await startPractice(page);

		// Question 1 first (never studied cards keep file order). Miss it.
		await expect(page.getByText('Question 1')).toBeVisible();
		await showAnswer(page);
		await expect(page.getByText('Answer 1')).toBeVisible();
		await page.getByRole('button', { name: /Missed it/ }).click();

		await expect(page.getByText('Question 2')).toBeVisible();
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();

		await expect(page.getByText('Question 3')).toBeVisible();
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();

		// The missed card is back.
		await expect(page.getByText('Question 1')).toBeVisible();
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();

		await expect(page.getByRole('heading', { name: 'Practice complete', level: 1 })).toBeVisible();
		await expect(page.getByText('You went through 3 cards in 4 answers.')).toBeVisible();
		await expect(page.getByText('2 of them were right the first time.')).toBeVisible();
		await expect(page.getByRole('button', { name: /Practice the 1 miss again/ })).toBeVisible();

		// Nothing was scheduled: all three cards are still new, and study serves the first one as new.
		expect(await deckCounts(request, 'e2e-pr-loop')).toEqual({ new: 3, learning: 0, review: 0 });
		const next = (await (await request.get('/api/study/next?deckId=e2e-pr-loop')).json()) as {
			item: { category: string };
		};
		expect(next.item.category).toBe('new');
	});

	test('practices only the misses again from the summary', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-pr-misses', 'E2E practice misses', basicCards(2, 'm')));
		await page.goto('/practice?deck=e2e-pr-misses');
		await page.getByLabel('Weakest first').check();
		await startPractice(page);
		for (const answer of [/Missed it/, /Got it/, /Got it/]) {
			await showAnswer(page);
			await page.getByRole('button', { name: answer }).click();
		}
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
		await page.getByRole('button', { name: /Practice the 1 miss again/ }).click();
		await expect(page.getByText('Question 1')).toBeVisible();
		await expect(page.getByLabel('Cards left in this practice session')).toContainText('Of 1');
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByText('You went through 1 card in 1 answer.')).toBeVisible();
	});

	test('works from the keyboard: Space to reveal, 1 and 3 to answer, Space for the suggestion', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-pr-keys', 'E2E practice keys', basicCards(2, 'k')));
		await page.goto('/practice?deck=e2e-pr-keys');
		await page.getByLabel('Weakest first').check();
		await startPractice(page);

		await expect(page.getByText('Question 1')).toBeVisible();
		await page.keyboard.press('Space');
		await expect(page.getByText('Answer 1')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page.getByText('Question 2')).toBeVisible();
		await page.keyboard.press('Space');
		await page.keyboard.press('3');
		await expect(page.getByText('Question 1')).toBeVisible();
		await page.keyboard.press('Space');
		await page.keyboard.press('Space');
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
	});

	test('limits the session to the chosen count', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-pr-count', 'E2E practice count', basicCards(25, 'n')));
		await page.goto('/practice?deck=e2e-pr-count');
		await expect(page.getByLabel('All 25')).toBeChecked();
		await page.getByLabel('20', { exact: true }).check();
		await startPractice(page);
		await expect(page.getByLabel('Cards left in this practice session')).toContainText('Left 20');
		await expect(page.getByLabel('Cards left in this practice session')).toContainText('Of 20');
	});

	test('resumes a session after a reload, or discards it', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-pr-resume', 'E2E practice resume', basicCards(4, 'r')));
		await page.goto('/practice?deck=e2e-pr-resume');
		await page.getByLabel('Weakest first').check();
		await startPractice(page);
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByText('Question 2')).toBeVisible();

		await page.reload();
		await expect(page.getByRole('group', { name: 'Resume the last session' })).toContainText(
			'3 cards left of 4'
		);
		await page.getByRole('button', { name: 'Resume' }).click();
		await expect(page.getByText('Question 2')).toBeVisible();

		await page.reload();
		await page.getByRole('button', { name: 'Discard it' }).click();
		await expect(page.getByRole('group', { name: 'Resume the last session' })).toHaveCount(0);
		await page.reload();
		await expect(page.getByRole('group', { name: 'Resume the last session' })).toHaveCount(0);
	});

	test('marks a typed card and a choice card, and loops a wrong answer back', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-pr-types', 'E2E practice types', [
				{ id: 'ty', type: 'typed', front: 'Capital of France?', answer: 'Paris' },
				{
					id: 'ch',
					type: 'choice',
					front: 'Which is a colour?',
					choices: ['Blue', 'Seven', 'Walk'],
					correct: 0
				}
			])
		);
		await page.goto('/practice?deck=e2e-pr-types');
		await page.getByLabel('Weakest first').check();
		await startPractice(page);

		await expect(page.getByText('Capital of France?')).toBeVisible();
		await page.getByRole('textbox', { name: 'Your answer' }).fill('Lyon');
		await page.keyboard.press('Enter');
		await expect(page.getByText('Your answer does not match.')).toBeVisible();
		await expect(page.getByText('Suggested: Missed it.')).toBeVisible();
		await page.getByRole('button', { name: /Missed it/ }).click();

		await expect(page.getByText('Which is a colour?')).toBeVisible();
		await page.getByRole('button', { name: /Blue/ }).click();
		await expect(page.getByText('Suggested: Got it.')).toBeVisible();
		await page.getByRole('button', { name: /Got it/ }).click();

		// The wrong typed answer comes back, now answered right.
		await expect(page.getByText('Capital of France?')).toBeVisible();
		await page.getByRole('textbox', { name: 'Your answer' }).fill('paris');
		await page.keyboard.press('Enter');
		await expect(page.getByText('Your answer matches.')).toBeVisible();
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
	});

	test('says so when there is nothing to practice, and when no deck is named', async ({
		page,
		request
	}) => {
		const made = await request.post('/api/decks', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ id: 'e2e-pr-empty', title: 'E2E practice empty' })
		});
		expect(made.status(), await made.text()).toBe(201);
		await page.goto('/practice?deck=e2e-pr-empty');
		await expect(page.getByText('There is nothing to practice here yet.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start practice' })).toHaveCount(0);

		await page.goto('/practice');
		await expect(page.getByRole('alert')).toContainText('Choose a deck or a folder to practice');
		await page.goto('/practice?deck=no-such-deck');
		await expect(page.getByRole('alert')).toContainText('no deck');
		await page.goto('/practice?deck=Bad%20Id&folder=3');
		await expect(page.getByRole('alert')).toContainText('Choose a deck or a folder to practice');
	});
});

test.describe('practicing a folder', () => {
	test('covers every deck in the folder from the folder button', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-pr-fa', 'E2E practice fa', basicCards(2, 'a')));
		await importViaApi(request, deckOf('e2e-pr-fb', 'E2E practice fb', basicCards(1, 'b')));
		await importViaApi(request, deckOf('e2e-pr-fc', 'E2E practice fc', basicCards(1, 'c')));
		const folderId = await makeFolder(request, 'E2E practice folder');
		const assigned = await request.put('/api/folder-assignments', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ deckIds: ['e2e-pr-fa', 'e2e-pr-fb'], folderId })
		});
		expect(assigned.ok()).toBe(true);

		await page.goto('/');
		await page.getByRole('link', { name: 'Practice folder E2E practice folder' }).click();
		await expect(page).toHaveURL(new RegExp(`/practice\\?folder=${folderId}$`));
		await expect(page.getByText('E2E practice folder', { exact: true }).first()).toBeVisible();
		await expect(page.getByLabel('All 3')).toBeChecked();
		await startPractice(page);
		await expect(page.getByLabel('Cards left in this practice session')).toContainText('Of 3');

		for (let i = 0; i < 3; i++) {
			await showAnswer(page);
			await page.getByRole('button', { name: /Got it/ }).click();
		}
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
		expect(await deckCounts(request, 'e2e-pr-fa')).toEqual({ new: 2, learning: 0, review: 0 });
		expect(await deckCounts(request, 'e2e-pr-fb')).toEqual({ new: 1, learning: 0, review: 0 });
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('every practice screen passes the accessibility scan', async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf(`e2e-pr-a11y-${scheme}`, `E2E practice a11y ${scheme}`, basicCards(2, 'x'))
			);
			await page.goto(`/practice?deck=e2e-pr-a11y-${scheme}`);
			await expect(page.getByRole('heading', { name: 'Practice again', level: 1 })).toBeVisible();
			await scan(page, 'setup');
			await page.getByLabel('Weakest first').check();
			await scan(page, 'setup, weakest first');

			await startPractice(page);
			await expect(page.getByText('Question 1')).toBeVisible();
			await scan(page, 'card, question side');
			await showAnswer(page);
			await expect(page.getByText('Answer 1')).toBeVisible();
			await scan(page, 'card, answer side');
			await page.getByRole('button', { name: /Missed it/ }).click();
			await page.reload();
			await expect(page.getByRole('group', { name: 'Resume the last session' })).toBeVisible();
			await scan(page, 'setup with a session to resume');
			await page.getByRole('button', { name: 'Resume' }).click();
			for (let i = 0; i < 2; i++) {
				await showAnswer(page);
				await page.getByRole('button', { name: /Got it/ }).click();
			}
			await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
			await scan(page, 'summary');
		});
	});
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test('does not scroll sideways on any practice screen', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-pr-phone', 'E2E practice phone', basicCards(2, 'q')));
		await page.goto('/practice?deck=e2e-pr-phone');
		await expect(page.getByRole('heading', { name: 'Practice again' })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		await page.getByLabel('Weakest first').check();
		await startPractice(page);
		await expect(page.getByText('Question 1')).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		await showAnswer(page);
		await expect(page.getByRole('button', { name: /Got it/ })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		await page.getByRole('button', { name: /Got it/ }).click();
		await showAnswer(page);
		await page.getByRole('button', { name: /Got it/ }).click();
		await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
	});
});
