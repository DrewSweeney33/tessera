import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Project folders: a folder groups decks on the decks screen, can be renamed and deleted, scopes a study session, and
// shows the numbers from studying the decks inside it. Every deck has its own id because the specs share one server,
// and every test removes the folders it made, so the other specs see the deck list they expect.

const JSON_HEADERS = { 'content-type': 'application/json' };

interface FolderRow {
	id: number;
	name: string;
}

async function folders(request: APIRequestContext): Promise<FolderRow[]> {
	const response = await request.get('/api/folders');
	return ((await response.json()) as { folders: FolderRow[] }).folders;
}

async function makeFolder(request: APIRequestContext, name: string): Promise<number> {
	const response = await request.post('/api/folders', {
		headers: JSON_HEADERS,
		data: JSON.stringify({ name })
	});
	expect(response.status(), await response.text()).toBe(201);
	return ((await response.json()) as { folder: FolderRow }).folder.id;
}

async function putInFolder(request: APIRequestContext, deckIds: string[], folderId: number | null) {
	const response = await request.put('/api/folder-assignments', {
		headers: JSON_HEADERS,
		data: JSON.stringify({ deckIds, folderId })
	});
	expect(response.ok(), await response.text()).toBe(true);
}

test.afterEach(async ({ request }) => {
	for (const folder of await folders(request)) {
		await request.delete(`/api/folders/${folder.id}`, { headers: JSON_HEADERS });
	}
	// Collapsed folders are remembered in the browser; each test starts with a fresh context, so nothing else to do.
});

async function seedDecks(request: APIRequestContext, prefix: string) {
	await importViaApi(request, deckOf(`${prefix}-one`, `${prefix} one`, basicCards(2, 'a')));
	await importViaApi(request, deckOf(`${prefix}-two`, `${prefix} two`, basicCards(3, 'b')));
	await importViaApi(request, deckOf(`${prefix}-solo`, `${prefix} solo`, basicCards(1, 'c')));
}

const folderRegion = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe('making a folder and putting decks in it', () => {
	test('creates a folder, moves two decks into it, and keeps the other deck in view', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f1');
		await page.goto('/');

		await page.getByRole('button', { name: 'New folder' }).click();
		await page.getByRole('textbox', { name: 'New folder' }).fill('E2E Course');
		await page.getByRole('button', { name: 'Create folder' }).click();
		await expect(folderRegion(page, 'E2E Course')).toBeVisible();
		await expect(folderRegion(page, 'E2E Course')).toContainText('0 decks');
		// The new-folder button has the focus back.
		await expect(page.getByRole('button', { name: 'New folder' })).toBeFocused();

		await page.getByRole('button', { name: 'Move decks' }).click();
		await page.getByLabel('Select e2e-f1 one').check();
		await page.getByLabel('Select e2e-f1 two').check();
		await expect(page.getByText('2 decks selected')).toBeVisible();
		await page.getByLabel('Move the selected decks to').selectOption({ label: 'E2E Course' });
		await page.getByRole('button', { name: 'Move', exact: true }).click();

		const course = folderRegion(page, 'E2E Course');
		await expect(course).toContainText('2 decks, 5 cards');
		await expect(course.getByRole('heading', { name: 'e2e-f1 one' })).toBeVisible();
		await expect(course.getByRole('heading', { name: 'e2e-f1 two' })).toBeVisible();
		await expect(course.getByRole('heading', { name: 'e2e-f1 solo' })).toBeHidden();

		// The deck that is in no folder is still on the screen, under its own heading.
		const loose = page.getByRole('region', { name: /Ungrouped decks/ });
		await expect(loose.getByRole('heading', { name: 'e2e-f1 solo' })).toBeVisible();

		// It is saved, not only shown.
		await page.reload();
		await expect(folderRegion(page, 'E2E Course')).toContainText('2 decks, 5 cards');
		const list = (await (await request.get('/api/decks')).json()) as {
			decks: { id: string; folderId: number | null }[];
		};
		const byId = Object.fromEntries(list.decks.map((deck) => [deck.id, deck.folderId]));
		expect(byId['e2e-f1-solo']).toBeNull();
		expect(byId['e2e-f1-one']).toBe(byId['e2e-f1-two']);
		expect(byId['e2e-f1-one']).not.toBeNull();
	});

	test('takes decks out of a folder again with "No folder"', async ({ page, request }) => {
		await seedDecks(request, 'e2e-f2');
		const id = await makeFolder(request, 'E2E Out');
		await putInFolder(request, ['e2e-f2-one'], id);
		await page.goto('/');
		await expect(folderRegion(page, 'E2E Out')).toContainText('1 deck, 2 cards');

		await page.getByRole('button', { name: 'Move decks' }).click();
		await page.getByLabel('Select e2e-f2 one').check();
		await page
			.getByLabel('Move the selected decks to')
			.selectOption({ label: 'No folder (ungrouped)' });
		await page.getByRole('button', { name: 'Move', exact: true }).click();
		await expect(folderRegion(page, 'E2E Out')).toContainText('0 decks');
	});

	test('selects every deck of a group at once', async ({ page, request }) => {
		await seedDecks(request, 'e2e-f3');
		await makeFolder(request, 'E2E All');
		await page.goto('/');
		await page.getByRole('button', { name: 'Move decks' }).click();
		await page.getByRole('button', { name: 'Select all ungrouped decks' }).click();
		const selected = await page.locator('input[type="checkbox"]:checked').count();
		expect(selected).toBeGreaterThanOrEqual(3);
		await page.getByRole('button', { name: 'Clear these' }).click();
		await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
	});

	test('says what is wrong with a name, next to the box, and keeps the form open', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f4');
		await makeFolder(request, 'E2E Taken');
		await page.goto('/');
		await page.getByRole('button', { name: 'New folder' }).click();

		await page.getByRole('button', { name: 'Create folder' }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Give the folder a name.' })
		).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'New folder' })).toBeFocused();

		await page.getByRole('textbox', { name: 'New folder' }).fill('e2e taken');
		await page.getByRole('button', { name: 'Create folder' }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'There is already a folder' })
		).toBeVisible();
		expect((await folders(request)).map((folder) => folder.name)).toEqual(['E2E Taken']);

		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('textbox', { name: 'New folder' })).toBeHidden();
	});
});

// The study day label for today in the test server's time zone (America/Chicago, day starting at 4 am), plus some days.
function studyDay(plusDays = 0): string {
	const today = new Date(Date.now() - 4 * 3_600_000).toLocaleDateString('en-CA', {
		timeZone: 'America/Chicago'
	});
	const [year, month, day] = today.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(year, month - 1, day + plusDays)).toISOString().slice(0, 10);
}

test.describe('an exam date on a folder', () => {
	test('sets a date, shows the countdown, and suggests practice in the last two weeks', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f10');
		await makeFolder(request, 'E2E Exam');
		await page.goto('/');
		const region = folderRegion(page, 'E2E Exam');
		await expect(region.getByText(/Exam (in|today|tomorrow|was)/)).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit folder E2E Exam' }).click();
		await expect(page.getByLabel('Exam date (optional)')).toHaveValue('');
		await page.getByLabel('Exam date (optional)').fill(studyDay(40));
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(region.getByText('Exam in 40 days')).toBeVisible();
		// More than two weeks away: no suggestion.
		await expect(region.getByRole('link', { name: 'Practice the folder' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit folder E2E Exam' }).click();
		await expect(page.getByLabel('Exam date (optional)')).toHaveValue(studyDay(40));
		await page.getByLabel('Exam date (optional)').fill(studyDay(5));
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(region.getByText('Exam in 5 days')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit folder E2E Exam' })).toBeFocused();
	});

	test('the suggestion is only shown when the folder has cards, and links to practice', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f11');
		const id = await makeFolder(request, 'E2E Exam Soon');
		await putInFolder(request, ['e2e-f11-one'], id);
		const response = await request.put(`/api/folders/${id}`, {
			headers: JSON_HEADERS,
			data: JSON.stringify({ examDate: studyDay(0) })
		});
		expect(response.ok()).toBe(true);
		await page.goto('/');
		const region = folderRegion(page, 'E2E Exam Soon');
		await expect(region.getByText('Exam today')).toBeVisible();
		await region.getByRole('link', { name: 'Practice the folder' }).click();
		await expect(page).toHaveURL(new RegExp(`/practice\\?folder=${id}$`));
		await expect(page.getByRole('heading', { name: 'Practice again', level: 1 })).toBeVisible();
	});

	test('clears the date, and keeps the name when only the date changes', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f12');
		const id = await makeFolder(request, 'E2E Clear');
		await request.put(`/api/folders/${id}`, {
			headers: JSON_HEADERS,
			data: JSON.stringify({ examDate: studyDay(3) })
		});
		await page.goto('/');
		const region = folderRegion(page, 'E2E Clear');
		await expect(region.getByText('Exam in 3 days')).toBeVisible();
		await page.getByRole('button', { name: 'Edit folder E2E Clear' }).click();
		// Safari has no way to empty a date field, so the form has its own button for it.
		await page.getByRole('button', { name: 'Clear date' }).click();
		await expect(page.getByLabel('Exam date (optional)')).toHaveValue('');
		await expect(page.getByRole('button', { name: 'Clear date' })).toHaveCount(0);
		const saved = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/folders/${id}`) && response.request().method() === 'PUT'
		);
		await page.getByRole('button', { name: 'Save' }).click();
		const response = await saved;
		const sent = response.request().postData();
		try {
			await expect(region.getByText(/Exam in/)).toHaveCount(0);
		} catch (error) {
			// What the page showed and what was sent, so a failure on another browser can be understood from the log.
			const alerts = await page.getByRole('alert').allInnerTexts();
			throw new Error(
				`${(error as Error).message}
PUT ${response.status()} sent ${sent} got ${await response.text()}
alerts: ${JSON.stringify(alerts)}
region: ${JSON.stringify(await region.innerText())}`,
				{ cause: error }
			);
		}
		await expect(folderRegion(page, 'E2E Clear')).toBeVisible();
		const kept = (await folders(request)).find((folder) => folder.id === id);
		expect(kept?.name).toBe('E2E Clear');
	});

	test('a date written in the wrong form is refused with the field named', async ({ request }) => {
		const id = await makeFolder(request, 'E2E Bad Date');
		const response = await request.put(`/api/folders/${id}`, {
			headers: JSON_HEADERS,
			data: JSON.stringify({ examDate: '31/12/2026' })
		});
		expect(response.status()).toBe(422);
		const body = (await response.json()) as { error: { details: { errors: { path: string }[] } } };
		expect(body.error.details.errors[0]?.path).toBe('examDate');
	});
});

test.describe('renaming and deleting a folder', () => {
	test('renames a folder in place, and refuses a name another folder has', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f5');
		await makeFolder(request, 'E2E Alpha');
		await makeFolder(request, 'E2E Beta');
		await page.goto('/');

		await page.getByRole('button', { name: 'Edit folder E2E Alpha' }).click();
		const box = page.getByRole('textbox', { name: 'Folder name' });
		await expect(box).toBeFocused();
		await box.fill('e2e beta');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'There is already a folder' })
		).toBeVisible();

		await box.fill('E2E Gamma');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(folderRegion(page, 'E2E Gamma')).toBeVisible();
		await expect(folderRegion(page, 'E2E Alpha')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Edit folder E2E Gamma' })).toBeFocused();
	});

	test('asks before deleting, and Keep folder changes nothing', async ({ page, request }) => {
		await seedDecks(request, 'e2e-f6');
		const id = await makeFolder(request, 'E2E Keep');
		await putInFolder(request, ['e2e-f6-one'], id);
		await page.goto('/');
		await page.getByRole('button', { name: 'Delete folder E2E Keep' }).click();
		await expect(page.getByText('Its 1 deck will go back to the ungrouped list.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Keep folder' })).toBeFocused();
		await page.getByRole('button', { name: 'Keep folder' }).click();
		await expect(page.getByText('Its 1 deck will go back')).toBeHidden();
		expect((await folders(request)).map((folder) => folder.name)).toContain('E2E Keep');
	});

	test('deletes the folder and puts its decks back in the ungrouped list, with their cards', async ({
		page,
		request
	}) => {
		await seedDecks(request, 'e2e-f7');
		const id = await makeFolder(request, 'E2E Gone');
		await putInFolder(request, ['e2e-f7-one', 'e2e-f7-two'], id);
		await page.goto('/');
		await page.getByRole('button', { name: 'Delete folder E2E Gone' }).click();
		await page.getByRole('button', { name: 'Delete folder', exact: true }).click();

		await expect(folderRegion(page, 'E2E Gone')).toBeHidden();
		await expect(page.getByRole('heading', { name: 'e2e-f7 one' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'e2e-f7 two' })).toBeVisible();
		await expect(page.locator('.row', { hasText: 'e2e-f7 two' })).toContainText('3 cards');
		expect((await folders(request)).map((folder) => folder.name)).not.toContain('E2E Gone');
	});
});

test.describe('studying a folder and reading its statistics', () => {
	test('studies only the decks in the folder, then shows the review in the folder statistics', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-f8-in', 'e2e-f8 in', basicCards(2, 'in')));
		await importViaApi(request, deckOf('e2e-f8-out', 'e2e-f8 out', basicCards(2, 'out')));
		const id = await makeFolder(request, 'E2E Study');
		await putInFolder(request, ['e2e-f8-in'], id);
		await page.goto('/');

		const course = folderRegion(page, 'E2E Study');
		await expect(course).toContainText('0 reviews today');
		await course.getByRole('link', { name: 'Study folder E2E Study' }).click();
		await expect(page).toHaveURL(new RegExp(`/study\\?folder=${id}$`));
		await expect(page.locator('p.deck')).toHaveText('E2E Study · e2e-f8 in');
		await expect(page.getByLabel('Items left to study')).toContainText('New 2');

		await page.getByRole('button', { name: 'Show answer' }).click();
		await page.getByRole('button', { name: /Good/ }).click();
		await expect(page.getByLabel('Items left to study')).toContainText('New 1');
		// The next card is still from the folder.
		await expect(page.locator('p.deck')).toHaveText('E2E Study · e2e-f8 in');

		await page.getByRole('link', { name: 'Decks' }).first().click();
		const after = folderRegion(page, 'E2E Study');
		await expect(after).toContainText('1 review today');
		await after.getByRole('button', { name: 'Statistics for E2E Study' }).click();
		const stats = page.getByRole('region', { name: 'Statistics for E2E Study' });
		await expect(stats).toContainText('Reviews today');
		await expect(stats.locator('.tile', { hasText: 'Reviews today' })).toContainText('1');
		await expect(stats.locator('.tile', { hasText: 'Streak' })).toContainText('1');
		await expect(stats).toContainText('2 cards in 1 deck');
		await expect(stats.getByRole('table', { name: /Reviews per study day/ })).toBeAttached();
	});

	test('shows the study button as done for a folder with nothing due, and for an empty folder', async ({
		page,
		request
	}) => {
		await makeFolder(request, 'E2E Empty');
		await page.goto('/');
		const empty = folderRegion(page, 'E2E Empty');
		await expect(empty).toContainText('No decks in this folder yet');
		await expect(empty.getByRole('link', { name: /Study folder/ })).toBeHidden();
	});

	test('an unknown folder in the study address studies nothing and says so', async ({ page }) => {
		await page.goto('/study?folder=999999');
		await expect(page.getByRole('alert')).toContainText('There is no such folder.');
	});
});

test.describe('the folder screen', () => {
	test('remembers which folders are collapsed', async ({ page, request }) => {
		await seedDecks(request, 'e2e-f9');
		const id = await makeFolder(request, 'E2E Fold');
		await putInFolder(request, ['e2e-f9-one'], id);
		await page.goto('/');
		const course = folderRegion(page, 'E2E Fold');
		await expect(course.getByRole('heading', { name: 'e2e-f9 one' })).toBeVisible();

		await course.getByRole('button', { name: 'E2E Fold', exact: true }).click();
		await expect(course.getByRole('heading', { name: 'e2e-f9 one' })).toBeHidden();
		await expect(course.getByRole('button', { name: 'E2E Fold', exact: true })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await page.reload();
		await expect(
			folderRegion(page, 'E2E Fold').getByRole('heading', { name: 'e2e-f9 one' })
		).toBeHidden();
		await folderRegion(page, 'E2E Fold')
			.getByRole('button', { name: 'E2E Fold', exact: true })
			.click();
		await expect(
			folderRegion(page, 'E2E Fold').getByRole('heading', { name: 'e2e-f9 one' })
		).toBeVisible();
	});

	test('works with the keyboard alone', async ({ page, request }) => {
		await seedDecks(request, 'e2e-f10');
		await page.goto('/');
		await page.getByRole('button', { name: 'New folder' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('textbox', { name: 'New folder' })).toBeFocused();
		await page.keyboard.type('E2E Keys');
		await page.keyboard.press('Enter');
		await expect(folderRegion(page, 'E2E Keys')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New folder' })).toBeFocused();
	});

	for (const width of [320, 375, 768]) {
		test(`has no sideways scrolling at ${width} px wide, with a folder, the stats, and the move bar`, async ({
			page,
			request
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await seedDecks(request, `e2e-f11-${width}`);
			const id = await makeFolder(request, 'E2E Narrow folder with a fairly long name to wrap');
			await putInFolder(request, [`e2e-f11-${width}-one`], id);
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
			await page.getByRole('button', { name: /Statistics for E2E Narrow/ }).click();
			await expect(page.getByText('Reviews today', { exact: true })).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
			await page.getByRole('button', { name: 'Move decks' }).click();
			await expect(page.getByLabel('Move the selected decks to')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
