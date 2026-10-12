import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// The Trash (US-13, ADR-013): a deleted deck waits in the Trash with everything it holds, can be restored, and is
// deleted for good only when its title is typed. Every deck here has its own id, because the specs share one server.

async function deckIds(request: APIRequestContext) {
	const response = await request.get('/api/decks');
	return ((await response.json()) as { decks: { id: string }[] }).decks.map((deck) => deck.id);
}

async function trashIds(request: APIRequestContext) {
	const response = await request.get('/api/trash');
	return ((await response.json()) as { decks: { id: string }[] }).decks.map((deck) => deck.id);
}

async function moveToTrashFromEditor(page: Page, id: string, title: string) {
	await page.goto('/');
	await page.getByRole('link', { name: `Edit ${title}` }).click();
	await expect(page).toHaveURL(new RegExp(`/decks/${id}/edit$`));
	await page.getByRole('button', { name: 'Move to Trash' }).first().click();
	await page.getByRole('button', { name: 'Move to Trash' }).last().click();
	await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
}

test.describe('moving a deck to the Trash', () => {
	test('takes it out of the deck list, the study session, and the editor, and lists it in the Trash', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-trash-move', 'E2E trash move', basicCards(3, 'm')));
		await moveToTrashFromEditor(page, 'e2e-trash-move', 'E2E trash move');

		await expect(page.getByText('is in the Trash')).toBeVisible();
		const row = page.locator('.row', { hasText: 'E2E trash move' });
		await expect(row).toContainText('3 cards');
		await expect(row).toContainText('0 reviews');

		expect(await deckIds(request)).not.toContain('e2e-trash-move');
		expect(await trashIds(request)).toContain('e2e-trash-move');

		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'E2E trash move' })).toBeHidden();
		await page.goto('/decks/e2e-trash-move/edit');
		await expect(page.getByText('There is no deck')).toBeVisible();
		await page.goto('/study/e2e-trash-move');
		await expect(page.getByRole('heading', { name: 'E2E trash move' })).toBeHidden();
	});

	test('asks first, and Cancel leaves the deck where it is', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-trash-cancel', 'E2E trash cancel', basicCards(1, 'c')));
		await page.goto('/decks/e2e-trash-cancel/edit');
		await page.getByRole('button', { name: 'Move to Trash' }).click();
		await expect(page.getByText('Move E2E trash cancel to the Trash?')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByText('Move E2E trash cancel to the Trash?')).toBeHidden();
		expect(await deckIds(request)).toContain('e2e-trash-cancel');
	});

	test('does not ask about unsaved edits a second time, and says they are not kept', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-trash-dirty', 'E2E trash dirty', basicCards(2, 'd')));
		await page.goto('/decks/e2e-trash-dirty/edit');
		await page.getByLabel('Title').fill('Changed title');
		await page.getByRole('button', { name: 'Move to Trash' }).first().click();
		await expect(page.getByText('Edits you have not saved are not kept.')).toBeVisible();
		let asked = 0;
		page.on('dialog', (dialog) => {
			asked++;
			void dialog.dismiss();
		});
		await page.getByRole('button', { name: 'Move to Trash' }).last().click();
		await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
		expect(asked).toBe(0);
		// The edit was never saved, so the deck still has its old title.
		await expect(page.locator('.row', { hasText: 'E2E trash dirty' })).toBeVisible();
	});
});

test.describe('restoring', () => {
	test('brings the deck back with the cards, and the study progress, it had', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-trash-restore', 'E2E trash restore', basicCards(3, 'r'))
		);
		await page.goto('/study/e2e-trash-restore');
		await expect(page.locator('.card')).toBeFocused();
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
		await expect
			.poll(async () => {
				const body = (await (await request.get('/api/decks')).json()) as {
					decks: { id: string; counts: { new: number } }[];
				};
				return body.decks.find((deck) => deck.id === 'e2e-trash-restore')?.counts.new;
			})
			.toBe(2);

		await moveToTrashFromEditor(page, 'e2e-trash-restore', 'E2E trash restore');
		const row = page.locator('.row', { hasText: 'E2E trash restore' });
		await expect(row).toContainText('1 review of history');
		await row.getByRole('button', { name: 'Restore E2E trash restore' }).click();
		await expect(page.getByText('is back in your decks')).toBeVisible();
		await expect(row).toBeHidden();

		await page.goto('/');
		const home = page.locator('.row', { hasText: 'E2E trash restore' });
		await expect(home).toContainText('3 cards');
		// Two new cards left, as before: the studied card kept its schedule.
		await expect(home.locator('.counts')).toContainText('New');
		const body = (await (await request.get('/api/decks')).json()) as {
			decks: { id: string; counts: { new: number } }[];
		};
		expect(body.decks.find((deck) => deck.id === 'e2e-trash-restore')?.counts.new).toBe(2);
	});

	test('the Trash says so when it is empty', async ({ page, request }) => {
		await page.goto('/trash');
		// Other specs may leave decks here; empty the Trash by restoring everything first.
		for (const id of await trashIds(request)) {
			await request.post(`/api/decks/${id}/restore`, {
				headers: { 'content-type': 'application/json' },
				data: '{}'
			});
		}
		await page.reload();
		await expect(page.getByText('The Trash is empty.')).toBeVisible();
	});
});

test.describe('deleting for good', () => {
	async function openPanel(page: Page, title: string) {
		await page.goto('/trash');
		await page.getByRole('button', { name: `Delete ${title} for good` }).click();
		return page.getByLabel(/Type the deck title to confirm/);
	}

	test('waits for the exact title, then deletes, says what was removed, and names the saved copy', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-trash-forever', 'E2E trash forever', basicCards(2, 'f'))
		);
		await request.post('/api/decks/e2e-trash-forever/trash', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});

		const typed = await openPanel(page, 'E2E trash forever');
		await expect(typed).toBeFocused();
		const confirm = page.getByRole('button', { name: 'Delete for good', exact: true });
		await expect(confirm).toBeDisabled();
		await typed.fill('e2e trash forever');
		await expect(confirm).toBeDisabled();
		await typed.fill('E2E trash');
		await expect(confirm).toBeDisabled();
		await typed.fill('E2E trash forever');
		await expect(confirm).toBeEnabled();
		await confirm.click();

		await expect(page.getByText('is deleted for good: 2 cards and 0 reviews')).toBeVisible();
		await expect(page.locator('code', { hasText: /^pre-delete-e2e-trash-forever-/ })).toBeVisible();
		expect(await trashIds(request)).not.toContain('e2e-trash-forever');
		expect(await deckIds(request)).not.toContain('e2e-trash-forever');
	});

	test('the same id can be used again afterwards', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-trash-reuse', 'E2E trash reuse', basicCards(1, 'u')));
		await request.post('/api/decks/e2e-trash-reuse/trash', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});
		const typed = await openPanel(page, 'E2E trash reuse');
		await typed.fill('E2E trash reuse');
		await page.getByRole('button', { name: 'Delete for good', exact: true }).click();
		await expect(page.getByText('is deleted for good')).toBeVisible();

		await page.goto('/decks/new');
		await page.getByLabel('Title').fill('E2E trash reuse');
		await page.getByLabel('Deck id').fill('e2e-trash-reuse');
		await page.getByRole('button', { name: 'Create deck' }).click();
		await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();
	});

	test('Cancel closes the panel and returns focus to the button that opened it', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-trash-nope', 'E2E trash nope', basicCards(1, 'n')));
		await request.post('/api/decks/e2e-trash-nope/trash', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});
		const typed = await openPanel(page, 'E2E trash nope');
		await typed.fill('E2E trash nope');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(typed).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Delete E2E trash nope for good' })
		).toBeFocused();
		expect(await trashIds(request)).toContain('e2e-trash-nope');
	});

	test('works with the keyboard alone, and Enter in the box confirms', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-trash-keys', 'E2E trash keys', basicCards(1, 'k')));
		await request.post('/api/decks/e2e-trash-keys/trash', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});
		await page.goto('/trash');
		const open = page.getByRole('button', { name: 'Delete E2E trash keys for good' });
		await open.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByLabel(/Type the deck title to confirm/)).toBeFocused();
		await page.keyboard.type('E2E trash keys');
		await page.keyboard.press('Enter');
		await expect(page.getByText('is deleted for good')).toBeVisible();
	});

	test('a title with markup is shown as text and never runs', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf(
				'e2e-trash-xss',
				'<img src=x onerror="window.__pwned=9"> E2E trash xss',
				basicCards(1, 'x')
			)
		);
		await request.post('/api/decks/e2e-trash-xss/trash', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});
		await page.goto('/trash');
		const row = page.locator('.row', { hasText: 'E2E trash xss' });
		await expect(row.getByRole('heading')).toContainText('<img src=x onerror=');
		expect(await row.locator('img').count()).toBe(0);
		await row.getByRole('button', { name: /for good/ }).click();
		expect(await page.locator('.danger img').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
			undefined
		);
	});
});

test.describe('small screens', () => {
	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px with the delete panel open`, async ({
			page,
			request
		}) => {
			await importViaApi(
				request,
				deckOf(
					'e2e-trash-narrow',
					'E2E trash narrow with a really long title that has to wrap ' + 'x'.repeat(60),
					basicCards(2, 'w')
				)
			);
			await request.post('/api/decks/e2e-trash-narrow/trash', {
				headers: { 'content-type': 'application/json' },
				data: '{}'
			});
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/trash');
			await page
				.getByRole('button', { name: /for good/ })
				.first()
				.click();
			await expect(page.locator('.danger')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
