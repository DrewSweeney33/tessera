import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Editing a deck in the page (US-12, ADR-013): the editor loads a deck with a revision, shows the changes before
// saving, saves through the import pipeline so studied cards keep their history, and refuses a save made from an
// out-of-date copy. Every deck here has its own id, because the specs share one server.

const card = (page: Page, n: number): Locator => page.locator('.card').nth(n - 1);

async function openEditor(page: Page, id: string, title: string) {
	await page.goto('/');
	await page.getByRole('link', { name: `Edit ${title}` }).click();
	await expect(page).toHaveURL(new RegExp(`/decks/${id}/edit$`));
	await expect(page.getByRole('heading', { name: 'Edit deck', level: 1 })).toBeVisible();
}

async function openCard(page: Page, n: number) {
	await page.getByRole('button', { name: `Edit card ${n}` }).click();
	return card(page, n);
}

async function reviewAndSave(page: Page) {
	await page.getByRole('button', { name: 'Review changes' }).click();
	const save = page.getByRole('button', { name: 'Save changes' });
	await expect(save).toBeVisible();
	await save.click();
	await expect(page.getByText('Saved.', { exact: false }).first()).toBeVisible();
}

async function deckSummary(request: APIRequestContext, id: string) {
	const response = await request.get('/api/decks');
	const body = (await response.json()) as {
		decks: { id: string; cardCount: number; counts: { new: number } }[];
	};
	return body.decks.find((deck) => deck.id === id);
}

async function exported(request: APIRequestContext, id: string) {
	const response = await request.get(`/api/decks/${id}/export?format=json`);
	expect(response.ok(), await response.text()).toBe(true);
	return (await response.json()) as {
		deck: { title: string; description?: string; tags?: string[] };
		cards: Record<string, unknown>[];
	};
}

test.describe('the editor', () => {
	test('opens from the home page and lists the cards with their text', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-open', 'E2E edit open', basicCards(3, 'o')));
		await openEditor(page, 'e2e-edit-open', 'E2E edit open');
		await expect(page.getByLabel('Title')).toHaveValue('E2E edit open');
		await expect(page.locator('.card')).toHaveCount(3);
		await expect(card(page, 2)).toContainText('Question 2');
		await expect(card(page, 2)).toContainText('Basic');
		await expect(page.getByRole('button', { name: 'Review changes' })).toBeDisabled();
		await expect(page.getByText('No changes yet.')).toBeVisible();
	});

	test('a deck that does not exist says so', async ({ page }) => {
		await page.goto('/decks/e2e-no-such-deck/edit');
		await expect(page.getByText('There is no deck')).toBeVisible();
		await expect(page.getByRole('link', { name: 'All decks' }).first()).toBeVisible();
	});

	test('editing a card keeps what was studied on it', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-keep', 'E2E edit keep', basicCards(3, 'k')));
		await page.goto('/study/e2e-edit-keep');
		await expect(page.locator('.card')).toBeFocused();
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
		await expect
			.poll(async () => (await deckSummary(request, 'e2e-edit-keep'))?.counts.new)
			.toBe(2);

		await openEditor(page, 'e2e-edit-keep', 'E2E edit keep');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('Question 1, reworded');
		await expect(page.getByText('1 changed.')).toBeVisible();
		await reviewAndSave(page);

		expect((await deckSummary(request, 'e2e-edit-keep'))?.counts.new).toBe(2);
		const doc = await exported(request, 'e2e-edit-keep');
		expect(doc.cards.find((c) => c['id'] === 'k-1')?.['front']).toBe('Question 1, reworded');
		// The id did not change, which is why the history stayed.
		expect(doc.cards).toHaveLength(3);
	});

	test('shows what will change before saving, and nothing is saved until Save', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-preview', 'E2E edit preview', basicCards(2, 'p')));
		await openEditor(page, 'e2e-edit-preview', 'E2E edit preview');
		const first = await openCard(page, 1);
		await first.getByLabel('Back').fill('A brand new answer');
		await page.getByRole('button', { name: 'Review changes' }).click();

		await expect(
			page.getByRole('heading', { name: 'Updating deck: E2E edit preview' })
		).toBeVisible();
		await expect(page.locator('.tally')).toContainText('Updated');
		const doc = await exported(request, 'e2e-edit-preview');
		expect(doc.cards[0]?.['back']).toBe('Answer 1');

		// Changing anything after the preview makes it stale and Save waits for a new review.
		await first.getByLabel('Back').fill('Another answer');
		await expect(page.getByText('You changed the deck after this preview')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
		await reviewAndSave(page);
		expect((await exported(request, 'e2e-edit-preview')).cards[0]?.['back']).toBe('Another answer');
	});

	test('deck details can be changed', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-details', 'E2E edit details', basicCards(2, 'd')));
		await openEditor(page, 'e2e-edit-details', 'E2E edit details');
		await page.getByLabel('Title').fill('E2E edit details renamed');
		await page.getByLabel('Description').fill('Now with a description');
		await page.getByLabel('Tags').fill('one, two, one');
		await expect(page.getByText('deck details changed')).toBeVisible();
		await reviewAndSave(page);
		const doc = await exported(request, 'e2e-edit-details');
		expect(doc.deck).toMatchObject({
			title: 'E2E edit details renamed',
			description: 'Now with a description',
			tags: ['one', 'two']
		});
	});
});

test.describe('adding, removing, and the four card types', () => {
	test('adds one card of each type, and the saved deck has them', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-types', 'E2E edit types', basicCards(1, 't')));
		await openEditor(page, 'e2e-edit-types', 'E2E edit types');

		// Basic
		await page.getByLabel('Type of card to add').selectOption('basic');
		await page.getByRole('button', { name: 'Add a card' }).click();
		await expect(page.locator('.card')).toHaveCount(2);
		await expect(page.getByLabel('Front')).toBeFocused();
		await page.keyboard.type('Added basic question');
		await page.getByLabel('Back').fill('Added basic answer');

		// Cloze
		await page.getByLabel('Type of card to add').selectOption('cloze');
		await page.getByRole('button', { name: 'Add a card' }).click();
		await expect(page.getByLabel('Text with blanks')).toBeFocused();
		await page.keyboard.type('The {{c1::DR}} and {{c2::BDR}} elect');

		// Typed
		await page.getByLabel('Type of card to add').selectOption('typed');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const typed = card(page, 4);
		await typed.getByLabel('Question').fill('Command to show routes?');
		await typed.getByLabel('Answer to type').fill('show ip route');
		await typed.getByLabel('Also accepted').fill('sh ip route\nshow ip r');

		// Multiple choice
		await page.getByLabel('Type of card to add').selectOption('choice');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const choice = card(page, 5);
		await choice.getByLabel('Question').fill('Which one?');
		await choice.getByLabel('Choice 1', { exact: true }).fill('Red');
		await choice.getByLabel('Choice 2', { exact: true }).fill('Blue');
		await choice.getByRole('button', { name: 'Add a choice' }).click();
		await choice.getByLabel('Choice 3', { exact: true }).fill('Green');
		await choice.getByLabel('Choice 2 is correct').check();
		await choice.getByLabel('Explanation').fill('Because blue.');

		await expect(page.getByText('4 new.')).toBeVisible();
		await reviewAndSave(page);

		const doc = await exported(request, 'e2e-edit-types');
		expect(doc.cards).toHaveLength(5);
		expect(doc.cards[1]).toMatchObject({
			type: 'basic',
			front: 'Added basic question',
			back: 'Added basic answer'
		});
		expect(doc.cards[2]).toMatchObject({
			type: 'cloze',
			text: 'The {{c1::DR}} and {{c2::BDR}} elect'
		});
		expect(doc.cards[3]).toMatchObject({
			type: 'typed',
			answer: 'show ip route',
			accept: ['sh ip route', 'show ip r']
		});
		expect(doc.cards[4]).toMatchObject({
			type: 'choice',
			choices: ['Red', 'Blue', 'Green'],
			correct: 1,
			explanation: 'Because blue.'
		});
		// New ids are made for you and are valid.
		for (const added of doc.cards.slice(1)) expect(added['id']).toMatch(/^card-[0-9a-f]{8}$/);

		// And the new deck can be studied: four new cards plus the old one, with the cloze counted twice.
		expect((await deckSummary(request, 'e2e-edit-types'))?.counts.new).toBe(6);
	});

	test('removing a card archives it on save, and it can be put back before then', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-remove', 'E2E edit remove', basicCards(3, 'r')));
		await openEditor(page, 'e2e-edit-remove', 'E2E edit remove');

		await page.getByRole('button', { name: 'Remove card 2' }).click();
		await expect(page.locator('.card')).toHaveCount(2);
		await expect(page.getByRole('heading', { name: 'Removed (1)' })).toBeVisible();
		await expect(page.getByText('1 removed.')).toBeVisible();

		// Put it back: the same place, and nothing to save.
		await page.getByRole('button', { name: 'Put back' }).click();
		await expect(page.locator('.card')).toHaveCount(3);
		await expect(card(page, 2)).toContainText('Question 2');
		await expect(page.getByText('No changes yet.')).toBeVisible();

		await page.getByRole('button', { name: 'Remove card 2' }).click();
		await reviewAndSave(page);
		expect((await deckSummary(request, 'e2e-edit-remove'))?.cardCount).toBe(2);
		const doc = await exported(request, 'e2e-edit-remove');
		expect(doc.cards.map((c) => c['id'])).toEqual(['r-1', 'r-3']);
	});

	test('a deck cannot be saved with no cards, and says why', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-empty', 'E2E edit empty', basicCards(1, 'e')));
		await openEditor(page, 'e2e-edit-empty', 'E2E edit empty');
		await page.getByRole('button', { name: 'Remove card 1' }).click();
		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(page.getByText('A deck needs at least one card')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add a card' })).toBeFocused();
		expect((await deckSummary(request, 'e2e-edit-empty'))?.cardCount).toBe(1);
	});

	test('a new card that is discarded leaves no trace', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-edit-discard-new', 'E2E edit discard new', basicCards(1, 'x'))
		);
		await openEditor(page, 'e2e-edit-discard-new', 'E2E edit discard new');
		await page.getByRole('button', { name: 'Add a card' }).click();
		await expect(page.locator('.card')).toHaveCount(2);
		await page.getByRole('button', { name: 'Remove card 2' }).click();
		await expect(page.getByRole('heading', { name: /Removed/ })).toBeHidden();
		await expect(page.getByText('No changes yet.')).toBeVisible();
	});
});

test.describe('problems are shown where you are looking', () => {
	test('a blank new card is not shouted at until you save, then every problem is beside its field', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-errors', 'E2E edit errors', basicCards(1, 'z')));
		await openEditor(page, 'e2e-edit-errors', 'E2E edit errors');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const added = card(page, 2);
		await expect(added.locator('.problem')).toHaveCount(0);

		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(added.getByLabel('Front')).toHaveAttribute('aria-invalid', 'true');
		await expect(added.getByLabel('Back')).toHaveAttribute('aria-invalid', 'true');
		await expect(added.locator('.problem').first()).toContainText('front must not be blank');
		await expect(added.getByLabel('Front')).toBeFocused();
		await expect(page.getByRole('alert').first()).toContainText('before saving');

		// Fixing the front clears its message at once; the back still has its own.
		await added.getByLabel('Front').fill('Now a question');
		await expect(added.getByLabel('Front')).not.toHaveAttribute('aria-invalid', 'true');
		await expect(added.getByLabel('Back')).toHaveAttribute('aria-invalid', 'true');
		expect((await exported(request, 'e2e-edit-errors')).cards).toHaveLength(1);
	});

	test('a visited field shows its problem as soon as you leave it', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-blur', 'E2E edit blur', basicCards(1, 'b')));
		await openEditor(page, 'e2e-edit-blur', 'E2E edit blur');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('');
		await first.getByLabel('Back').focus();
		await expect(first.getByLabel('Front')).toHaveAttribute('aria-invalid', 'true');
		await expect(first.locator('.problem')).toContainText('front must not be blank');
	});

	test('a cloze with a broken marker says where, and a cloze with none says what to add', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-cloze', 'E2E edit cloze', basicCards(1, 'c')));
		await openEditor(page, 'e2e-edit-cloze', 'E2E edit cloze');
		await page.getByLabel('Type of card to add').selectOption('cloze');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const added = card(page, 2);
		await added.getByLabel('Text with blanks').fill('Nothing to hide here');
		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(added.locator('.problem')).toContainText('needs at least one cloze marker');

		await added.getByLabel('Text with blanks').fill('Open {{c1::never closed');
		await expect(added.locator('.problem').first()).toContainText('never closed');
		await expect(added.locator('.problem').first()).toContainText('line 1, column 6');
	});

	test('multiple choice: duplicates, blanks, and the right answer are checked, and removing a choice keeps the right one', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-choice', 'E2E edit choice', basicCards(1, 'm')));
		await openEditor(page, 'e2e-edit-choice', 'E2E edit choice');
		await page.getByLabel('Type of card to add').selectOption('choice');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const added = card(page, 2);
		await added.getByLabel('Question').fill('Pick');
		await added.getByLabel('Choice 1', { exact: true }).fill('Same');
		await added.getByLabel('Choice 2', { exact: true }).fill('same');
		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(added.locator('.problem')).toContainText('choice 2 repeats choice 1');

		await added.getByRole('button', { name: 'Add a choice' }).click();
		await added.getByLabel('Choice 2', { exact: true }).fill('Other');
		await added.getByLabel('Choice 3', { exact: true }).fill('Third');
		await added.getByLabel('Choice 3 is correct').check();
		// Removing the first choice moves the right answer up with its text.
		await added.getByRole('button', { name: 'Remove choice 1' }).click();
		await expect(added.getByLabel('Choice 2 is correct')).toBeChecked();
		await expect(added.getByLabel('Choice 2', { exact: true })).toHaveValue('Third');
		// Two choices is the least, so the remove buttons are now off.
		await expect(added.getByRole('button', { name: 'Remove choice 1' })).toBeDisabled();
	});
});

test.describe('another tab, another edit', () => {
	test('a save from a stale copy is refused, nothing is lost, and the deck can be reloaded', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-stale', 'E2E edit stale', basicCards(2, 's')));
		await openEditor(page, 'e2e-edit-stale', 'E2E edit stale');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('My edit in this tab');

		// Someone (another tab, or Claude re-importing) changes the deck in the meantime.
		const other = deckOf('e2e-edit-stale', 'E2E edit stale', basicCards(2, 's'));
		other.cards[1]!['back'] = 'Changed elsewhere';
		await importViaApi(request, other);

		await page.getByRole('button', { name: 'Review changes' }).click();
		await expect(page.getByText('This deck changed somewhere else')).toBeVisible();
		await expect(page.getByRole('alert').first()).toContainText('Nothing was saved');
		let doc = await exported(request, 'e2e-edit-stale');
		expect(doc.cards[0]?.['front']).toBe('Question 1');
		expect(doc.cards[1]?.['back']).toBe('Changed elsewhere');

		// The edit stays on screen, so the text can be copied out before reloading.
		await expect(first.getByLabel('Front')).toHaveValue('My edit in this tab');

		await page.getByRole('button', { name: /Reload the deck/ }).click();
		await expect(page.getByText('This deck changed somewhere else')).toBeHidden();
		await expect(card(page, 2)).toContainText('Question 2');
		await (await openCard(page, 1)).getByLabel('Front').fill('My edit, second try');
		await reviewAndSave(page);
		doc = await exported(request, 'e2e-edit-stale');
		expect(doc.cards[0]?.['front']).toBe('My edit, second try');
		expect(doc.cards[1]?.['back']).toBe('Changed elsewhere');
	});

	test('studying in another tab does not make the editor stale', async ({
		page,
		request,
		context
	}) => {
		await importViaApi(request, deckOf('e2e-edit-study', 'E2E edit study', basicCards(2, 'y')));
		await openEditor(page, 'e2e-edit-study', 'E2E edit study');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('Edited while someone studies');

		const studyTab = await context.newPage();
		await studyTab.goto('/study/e2e-edit-study');
		await expect(studyTab.locator('.card')).toBeFocused();
		await studyTab.keyboard.press('Space');
		await studyTab.keyboard.press('4');
		await studyTab.close();

		await reviewAndSave(page);
		expect((await exported(request, 'e2e-edit-study')).cards[0]?.['front']).toBe(
			'Edited while someone studies'
		);
	});
});

test.describe('leaving with unsaved changes', () => {
	test('asks first, stays if you say no, and leaves if you say yes', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-leave', 'E2E edit leave', basicCards(2, 'l')));
		await openEditor(page, 'e2e-edit-leave', 'E2E edit leave');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('Unsaved words');

		let asked = 0;
		page.once('dialog', async (dialog) => {
			asked++;
			expect(dialog.message()).toContain('not saved');
			await dialog.dismiss();
		});
		await page.getByRole('link', { name: 'All decks' }).first().click();
		await expect.poll(() => asked).toBe(1);
		await expect(page).toHaveURL(/\/edit$/);
		await expect(first.getByLabel('Front')).toHaveValue('Unsaved words');

		page.once('dialog', (dialog) => void dialog.accept());
		await page.getByRole('link', { name: 'All decks' }).first().click();
		await expect(page).toHaveURL(/\/$/);
	});

	test('does not ask when nothing changed, or after saving', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-noask', 'E2E edit noask', basicCards(2, 'n')));
		await openEditor(page, 'e2e-edit-noask', 'E2E edit noask');
		let asked = 0;
		page.on('dialog', (dialog) => {
			asked++;
			void dialog.accept();
		});
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('Changed then saved');
		await reviewAndSave(page);
		await page.getByRole('link', { name: 'All decks' }).first().click();
		await expect(page).toHaveURL(/\/$/);
		expect(asked).toBe(0);
	});

	test('discarding changes puts the deck back as it was', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-undo', 'E2E edit undo', basicCards(2, 'u')));
		await openEditor(page, 'e2e-edit-undo', 'E2E edit undo');
		await page.getByLabel('Title').fill('Something else');
		await page.getByRole('button', { name: 'Remove card 1' }).click();
		await page.getByRole('button', { name: 'Discard changes' }).click();
		await expect(page.getByText(/Throw away/)).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(page.getByLabel('Title')).toHaveValue('Something else');
		await page.getByRole('button', { name: 'Discard changes' }).click();
		await page.getByRole('button', { name: 'Discard', exact: true }).click();
		await expect(page.getByLabel('Title')).toHaveValue('E2E edit undo');
		await expect(page.locator('.card')).toHaveCount(2);
		await expect(page.getByText('No changes yet.')).toBeVisible();
	});
});

test.describe('the preview and safety', () => {
	test('shows the card as it will be studied, with Markdown, and never runs markup', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-md', 'E2E edit md', basicCards(1, 'w')));
		await openEditor(page, 'e2e-edit-md', 'E2E edit md');
		const first = await openCard(page, 1);
		await first.getByLabel('Front').fill('Say **bold** and <img src=x onerror="window.__pwned=1">');
		await first.getByLabel('Back').fill('[click](javascript:window.__pwned=2)');
		const preview = first.locator('.preview');
		await expect(preview.locator('strong')).toHaveText('bold');
		expect(await preview.locator('img').count()).toBe(0);
		expect(await preview.locator('a[href^="javascript"]').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
			undefined
		);
	});

	test('a cloze preview shows each blank as the study screen will', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-edit-clozeprev', 'E2E edit clozeprev', basicCards(1, 'v'))
		);
		await openEditor(page, 'e2e-edit-clozeprev', 'E2E edit clozeprev');
		await page.getByLabel('Type of card to add').selectOption('cloze');
		await page.getByRole('button', { name: 'Add a card' }).click();
		const added = card(page, 2);
		await added.getByLabel('Text with blanks').fill('The {{c1::DR::role}} and {{c2::BDR}}');
		const preview = added.locator('.preview');
		await expect(preview).toContainText('Blank 1');
		await expect(preview).toContainText('Blank 2');
		await expect(preview).toContainText('[role]');
	});

	test('markup in a deck title and a card is shown as text in the list', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('e2e-edit-markup', 'E2E edit markup', [
				{ id: 'm1', type: 'basic', front: '<b onmouseover="window.__pwned=3">Bold?</b>', back: 'x' }
			])
		);
		await openEditor(page, 'e2e-edit-markup', 'E2E edit markup');
		await expect(card(page, 1)).toContainText('<b onmouseover=');
		expect(await card(page, 1).locator('b').count()).toBe(0);
	});
});

test.describe('big decks and exports', () => {
	test('shows fifty cards at a time, finds a card in a long deck, and adds from the end', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('e2e-edit-big', 'E2E edit big', basicCards(120, 'g')));
		await openEditor(page, 'e2e-edit-big', 'E2E edit big');
		await expect(page.locator('.card')).toHaveCount(50);
		await page.getByRole('button', { name: /Show 50 more/ }).click();
		await expect(page.locator('.card')).toHaveCount(100);
		await page.getByRole('button', { name: /Show 20 more/ }).click();
		await expect(page.locator('.card')).toHaveCount(120);

		await page.getByLabel('Find a card').fill('Question 117');
		await expect(page.locator('.card')).toHaveCount(1);
		await expect(page.getByText('1 card matches.')).toBeVisible();
		await page.getByLabel('Find a card').fill('no such words');
		await expect(page.locator('.card')).toHaveCount(0);
	});

	test('exports the deck as JSON and as Markdown from the editor', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-export', 'E2E edit export', basicCards(2, 'f')));
		await openEditor(page, 'e2e-edit-export', 'E2E edit export');

		const json = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export JSON' }).click();
		expect((await json).suggestedFilename()).toBe('e2e-edit-export.json');

		const markdown = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export Markdown' }).click();
		expect((await markdown).suggestedFilename()).toBe('e2e-edit-export.md');
	});

	test('the Study link goes to this deck', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('e2e-edit-studylink', 'E2E edit studylink', basicCards(1, 'q'))
		);
		await openEditor(page, 'e2e-edit-studylink', 'E2E edit studylink');
		await page.getByRole('link', { name: 'Study', exact: true }).click();
		await expect(page).toHaveURL(/\/study\/e2e-edit-studylink$/);
	});
});

test.describe('keyboard and small screens', () => {
	test('a card can be edited and saved with the keyboard alone', async ({ page, request }) => {
		await importViaApi(request, deckOf('e2e-edit-keys', 'E2E edit keys', basicCards(2, 'j')));
		await openEditor(page, 'e2e-edit-keys', 'E2E edit keys');

		await page.getByRole('button', { name: 'Edit card 1' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Close card 1' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		await page.getByLabel('Front').focus();
		await page.keyboard.press('Control+A');
		await page.keyboard.type('Typed with the keyboard');
		await page.getByRole('button', { name: 'Review changes' }).focus();
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: 'Save changes' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByText('Saved.', { exact: false }).first()).toBeVisible();
		expect((await exported(request, 'e2e-edit-keys')).cards[0]?.['front']).toBe(
			'Typed with the keyboard'
		);
	});

	for (const width of [320, 375, 768]) {
		test(`nothing overflows at ${width}px with every card type open`, async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf('e2e-edit-narrow', 'E2E edit narrow with a rather long title that has to wrap', [
					{
						id: 'n1',
						type: 'basic',
						front: 'A '.repeat(80) + 'verylongunbrokenwordthatshouldwrap'.repeat(4),
						back: 'b'
					},
					{ id: 'n2', type: 'cloze', text: 'x {{c1::y}} ' + 'z'.repeat(120) },
					{ id: 'n3', type: 'typed', front: 'q', answer: 'a', accept: ['alt one', 'alt two'] },
					{ id: 'n4', type: 'choice', front: 'q', choices: ['aaaa '.repeat(30), 'b'], correct: 1 }
				])
			);
			await page.setViewportSize({ width, height: 900 });
			await openEditor(
				page,
				'e2e-edit-narrow',
				'E2E edit narrow with a rather long title that has to wrap'
			);
			for (let n = 1; n <= 4; n++) await openCard(page, n);
			await expect(page.locator('.card--open')).toHaveCount(4);
			expect(await scrollsHorizontally(page)).toBe(false);
		});
	}
});
