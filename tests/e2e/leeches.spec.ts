import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, makeLeech, scrollsHorizontally } from './helpers.ts';

// Leeches and the weak-spot report (US-6, ADR-015). Each deck has its own id, because the specs share one server. The
// leech list is the whole server's, so tests look at their own rows, not at counts of the whole list.

async function openLeeches(page: Page) {
	await page.goto('/leeches');
	await expect(page.getByRole('heading', { name: 'Leeches', level: 1 })).toBeVisible();
}

const row = (page: Page, text: string) => page.locator('.row', { hasText: text });

test.describe('the leech list', () => {
	test('is reached from the deck list, which shows how many need attention', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-leech-home', 'E2E leech home', basicCards(2, 'h')));
		makeLeech('e2e-leech-home', 'h-1');
		await page.goto('/');
		const link = page.getByRole('link', { name: /^Leeches/ });
		await expect(link).toHaveText(/Leeches\s+\(\d+\)/);
		await link.click();
		await expect(page.getByRole('heading', { name: 'Leeches', level: 1 })).toBeVisible();
	});

	test('shows the card, the deck, the counts, and the wrong answers typed', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-leech-show', 'E2E leech show', [
				{ id: 'cmd', type: 'typed', front: 'Command to show routes?', answer: 'show ip route' }
			])
		);
		makeLeech('e2e-leech-show', 'cmd', { lapses: 11, wrongAnswers: ['show route', 'sh route'] });
		await openLeeches(page);
		const leech = row(page, 'Command to show routes?');
		await expect(leech).toContainText('E2E leech show');
		await expect(leech).toContainText('11 lapses');
		await expect(leech).toContainText('show ip route');
		await expect(leech.locator('.wrong code')).toHaveText(['sh route', 'show route']);
	});

	test('lists the blanks of a cloze card separately', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-leech-cloze', 'E2E leech cloze', [
				{ id: 'timers', type: 'cloze', text: 'Hello {{c1::10}} and dead {{c2::40}}' }
			])
		);
		makeLeech('e2e-leech-cloze', 'timers', { ordinal: 1, lapses: 8 });
		makeLeech('e2e-leech-cloze', 'timers', { ordinal: 2, lapses: 12 });
		await openLeeches(page);
		const rows = page.locator('.row', { hasText: 'E2E leech cloze' });
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText('blank 2');
		await expect(rows.last()).toContainText('blank 1');
	});

	test('can be limited to one deck', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-leech-a', 'E2E leech filter a', basicCards(1, 'a')));
		await importViaApi(request, deckOf('e2e-leech-b', 'E2E leech filter b', basicCards(1, 'b')));
		makeLeech('e2e-leech-a', 'a-1');
		makeLeech('e2e-leech-b', 'b-1');
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech filter a' });
		await expect(page.locator('.row', { hasText: 'E2E leech filter a' })).toBeVisible();
		await expect(page.locator('.row', { hasText: 'E2E leech filter b' })).toBeHidden();
	});

	test('Reset clears the flag and takes the card off the list', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-leech-reset', 'E2E leech reset', basicCards(1, 'r')));
		makeLeech('e2e-leech-reset', 'r-1');
		await openLeeches(page);
		const leech = row(page, 'E2E leech reset');
		await leech.getByRole('button', { name: /Reset the leech flag/ }).click();
		await expect(leech).toBeHidden();
		const body = (await (await request.get('/api/leeches?deckId=e2e-leech-reset')).json()) as {
			leeches: unknown[];
		};
		expect(body.leeches).toEqual([]);
	});

	test('Set aside takes the card out of study sessions, and Put back returns it', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-leech-aside', 'E2E leech aside', basicCards(2, 's')));
		makeLeech('e2e-leech-aside', 's-1');
		const newCount = async () => {
			const body = (await (await request.get('/api/decks')).json()) as {
				decks: { id: string; counts: { new: number; learning: number; review: number } }[];
			};
			const counts = body.decks.find((d) => d.id === 'e2e-leech-aside')?.counts;
			return counts ? counts.new + counts.learning + counts.review : undefined;
		};
		const before = await newCount();
		await openLeeches(page);
		const leech = row(page, 'E2E leech aside');
		await leech.getByRole('button', { name: /Set card s-1 aside/ }).click();
		await expect(leech.locator('.badge')).toHaveText('Set aside');
		expect(await newCount()).toBe(before! - 1);

		await leech.getByRole('button', { name: /Put card s-1 back/ }).click();
		await expect(leech.locator('.badge')).toBeHidden();
		expect(await newCount()).toBe(before);
	});

	test('says so when nothing is a leech', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-leech-none', 'E2E leech none', basicCards(1, 'n')));
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech none' });
		await expect(page.getByText('No leeches. Nothing is being forgotten')).toBeVisible();
	});

	test('shows card markup as text and never runs it', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-leech-xss', 'E2E leech xss', [
				{
					id: 'x',
					type: 'typed',
					front: '<img src=x onerror="window.__pwned=11"> **bold**',
					answer: 'a'
				}
			])
		);
		makeLeech('e2e-leech-xss', 'x', { wrongAnswers: ['<img src=x onerror="window.__pwned=12">'] });
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech xss' });
		const leech = row(page, 'E2E leech xss');
		await expect(leech.locator('strong')).toHaveText('bold');
		await expect(leech.locator('.wrong code')).toContainText('<img src=x onerror=');
		expect(await leech.locator('img').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
			undefined
		);
	});
});

test.describe('the weak-spot report', () => {
	test('is copied with one button, or shown for copying when the browser refuses', async ({
		page,
		request,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
		await importViaApi(request, deckOf('e2e-leech-copy', 'E2E leech copy', basicCards(1, 'c')));
		makeLeech('e2e-leech-copy', 'c-1');
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech copy' });
		await page.getByRole('button', { name: 'Copy the weak-spot report for Claude' }).click();

		const copied = page.locator('.callout--ok', { hasText: 'Copied.' });
		const manual = page.getByLabel(/blocked copying/);
		await expect(copied.or(manual)).toBeVisible();
		if (await manual.isVisible()) {
			await expect(manual).toHaveValue(/# Tessera weak-spot report/);
			await expect(manual).toHaveValue(/"id": "c-1"/);
		}
	});

	test('closes the loop: the report holds an editable deck block, and importing the revised block updates the card and keeps its history', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-leech-loop', 'E2E leech loop', [
				{
					id: 'vague',
					type: 'basic',
					front: 'Tell me about OSPF timers',
					back: 'Hello 10, dead 40'
				},
				{ id: 'fine', type: 'basic', front: 'Fine card', back: 'Fine' }
			])
		);
		makeLeech('e2e-leech-loop', 'vague', { lapses: 10 });

		// 1. The report, as the page would hand it over.
		const report = await (await request.get('/api/report/weak-spots?deckId=e2e-leech-loop')).text();
		expect(report).toContain('What I would like you to do');
		const block = /```json\n([\s\S]*?)\n```/.exec(report)?.[1];
		expect(block).toBeTruthy();
		const deck = JSON.parse(block!) as {
			deck: { id: string };
			cards: { id: string; type: string; front: string }[];
		};
		// Only the leech card, with its id and type.
		expect(deck.cards.map((c) => [c.id, c.type])).toEqual([['vague', 'basic']]);

		// 2. Claude revises the card in the block and sends it back.
		deck.cards[0]!.front =
			'What are the default OSPF hello and dead intervals on broadcast networks?';
		await importViaApi(request, deck);

		// 3. The card changed, the other card did not, and the history is still there.
		const exported = (await (await request.get('/api/decks/e2e-leech-loop/export')).json()) as {
			cards: { id: string; front: string }[];
		};
		expect(exported.cards.find((c) => c.id === 'vague')?.front).toMatch(/default OSPF hello/);
		expect(exported.cards.find((c) => c.id === 'fine')?.front).toBe('Fine card');
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech loop' });
		const leech = row(page, 'E2E leech loop');
		await expect(leech).toContainText('default OSPF hello');
		await expect(leech).toContainText('10 lapses');
	});
});

test.describe('on small screens and with the keyboard', () => {
	test('the actions work with the keyboard alone', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-leech-keys', 'E2E leech keys', basicCards(1, 'k')));
		makeLeech('e2e-leech-keys', 'k-1');
		await openLeeches(page);
		await page.getByLabel('Show', { exact: true }).selectOption({ label: 'E2E leech keys' });
		const reset = page.getByRole('button', { name: /Reset the leech flag of card k-1/ });
		await reset.focus();
		await page.keyboard.press('Enter');
		await expect(row(page, 'E2E leech keys')).toBeHidden();
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px`, async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf('e2e-leech-narrow', 'E2E leech narrow with a long title that has to wrap properly', [
					{
						id: 'long',
						type: 'typed',
						front: 'A '.repeat(80) + 'verylongunbrokenwordthatshouldwrap'.repeat(4),
						answer: 'a'.repeat(120)
					}
				])
			);
			makeLeech('e2e-leech-narrow', 'long', { wrongAnswers: ['w'.repeat(190)] });
			await page.setViewportSize({ width, height: 900 });
			await openLeeches(page);
			await expect(row(page, 'E2E leech narrow')).toBeVisible();
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
