import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Studying the four card types end to end (M2-10). Typed and choice cards ask for an attempt and then
// suggest a grade. The learner can always pick another one.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scan(page: Page, label: string) {
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const summary = results.violations.map(
		(v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
	);
	expect(summary, label).toEqual([]);
}

// Good, Hard and Again leave a new card in a learning step, and with nothing else due it is offered again.
async function expectAgainInLearning(page: Page) {
	await expect(page.locator('.card__category')).toHaveText('Learning');
	await expect(page.locator('.card__back')).toHaveCount(0);
}

const typedCard = {
	id: 't1',
	type: 'typed' as const,
	front: 'Command to list OSPF neighbors?',
	answer: 'show ip ospf neighbor',
	accept: ['sh ip ospf nei'],
	hint: 'It starts with show'
};

const choiceCard = {
	id: 'c1',
	type: 'choice' as const,
	front: 'Which LSA type describes a network segment?',
	choices: ['Type 1', 'Type 2', 'Type 3', 'Type 5'],
	correct: 1,
	explanation: 'The DR originates Type 2.'
};

// The number key of the choice with this text, which depends on the shuffle.
async function keyFor(page: Page, text: string): Promise<string> {
	const index = await page
		.locator('.choices li')
		.evaluateAll(
			(items, wanted) => items.findIndex((li) => li.textContent?.includes(wanted)),
			text
		);
	expect(index, `choice "${text}" is shown`).toBeGreaterThanOrEqual(0);
	return String(index + 1);
}

test.describe('typed cards', () => {
	test('the answer box has focus, and a right answer suggests Good', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-typed-right', 'Typed right', [typedCard]));
		await page.goto('/study/ct-typed-right');

		const box = page.getByLabel('Your answer');
		await expect(box).toBeFocused();
		await box.fill('  SHOW  IP OSPF   NEIGHBOR. ');
		await page.keyboard.press('Enter');

		await expect(page.locator('.result')).toHaveText('Your answer matches.');
		await expect(page.locator('.yours')).toContainText('SHOW  IP OSPF   NEIGHBOR.');
		await expect(page.locator('.card__back')).toContainText('show ip ospf neighbor');
		await expect(page.locator('.grade--3')).toBeFocused();
		await expect(page.locator('.grade--suggested')).toHaveCount(1);
		await expect(page.locator('.grade--suggested')).toHaveClass(/grade--3/);
		await expect(page.locator('.suggest')).toContainText('Suggested: Good');

		await page.keyboard.press('Space');
		await expectAgainInLearning(page);
		await expect(page.getByLabel('Your answer')).toHaveValue('');
		await expect(page.getByLabel('Your answer')).toBeFocused();
		await expect(page.locator('.result')).toHaveCount(0);

		// Easy graduates it, which ends the session.
		await page.getByLabel('Your answer').fill('show ip ospf neighbor');
		await page.keyboard.press('Enter');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
		await expect(page.locator('.done')).toContainText('1 Good');
		await expect(page.locator('.done')).toContainText('1 Easy');
	});

	test('an accepted alternative also counts as right', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-typed-accept', 'Typed accept', [typedCard]));
		await page.goto('/study/ct-typed-accept');
		await page.getByLabel('Your answer').fill('sh ip ospf nei');
		await page.getByRole('button', { name: 'Check answer' }).click();
		await expect(page.locator('.result')).toHaveText('Your answer matches.');
	});

	test('a wrong answer suggests Again but the learner can pick Good', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-typed-wrong', 'Typed wrong', [typedCard]));
		await page.goto('/study/ct-typed-wrong');
		await page.getByLabel('Your answer').fill('show ip route');
		await page.keyboard.press('Enter');

		await expect(page.locator('.result')).toHaveText('Your answer does not match.');
		await expect(page.locator('.yours')).toContainText('show ip route');
		await expect(page.locator('.card__back')).toContainText('show ip ospf neighbor');
		await expect(page.locator('.card__back')).toContainText('Also accepted');
		await expect(page.locator('.grade--1')).toBeFocused();
		await expect(page.locator('.suggest')).toContainText('Suggested: Again');
		await expect(page.locator('.keys')).toContainText('Space for Again');

		// The learner knows better than the matcher and grades Good. That grade is what is recorded.
		await page.keyboard.press('3');
		await expectAgainInLearning(page);
		await page.getByLabel('Your answer').fill('show ip ospf neighbor');
		await page.keyboard.press('Enter');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
		await expect(page.locator('.done')).toContainText('1 Good');
		await expect(page.locator('.done')).toContainText('0 Again');
	});

	test('"I don’t know" shows the answer and suggests Again', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-typed-skip', 'Typed skip', [typedCard]));
		await page.goto('/study/ct-typed-skip');
		await page.getByRole('button', { name: 'I don’t know' }).click();
		await expect(page.locator('.result')).toHaveText('You did not type an answer.');
		await expect(page.locator('.yours')).toHaveCount(0);
		await expect(page.locator('.grade--1')).toBeFocused();
	});

	test('typing the letters H and a digit goes into the box and does not trigger a shortcut', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('ct-typed-keys', 'Typed keys', [typedCard]));
		await page.goto('/study/ct-typed-keys');
		const box = page.getByLabel('Your answer');
		await box.pressSequentially('h 1 2 3 4');
		await expect(box).toHaveValue('h 1 2 3 4');
		await expect(page.locator('.card__back')).toHaveCount(0);
		await expect(page.locator('.hint')).toHaveCount(0);
	});
});

test.describe('choice cards', () => {
	test('picking the right option by its number key suggests Good and shows the explanation', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('ct-choice-right', 'Choice right', [choiceCard]));
		await page.goto('/study/ct-choice-right');
		await expect(page.locator('.choice')).toHaveCount(4);

		await page.keyboard.press(await keyFor(page, 'Type 2'));
		await expect(page.locator('.result')).toHaveText('Correct.');
		await expect(page.locator('.choice--right')).toContainText('Type 2');
		await expect(page.locator('.choice--right')).toContainText('✓ Right answer');
		await expect(page.locator('.card__back')).toContainText('The DR originates Type 2.');
		await expect(page.locator('.grade--3')).toBeFocused();

		await page.keyboard.press('Enter');
		await expectAgainInLearning(page);
		// The options are open again for the next attempt.
		await expect(page.locator('.choice').first()).toBeEnabled();
		await expect(page.locator('.result')).toHaveCount(0);
		await page.keyboard.press('1');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
		await expect(page.locator('.done')).toContainText('1 Good');
	});

	test('a wrong option is marked, the right one is shown, and Again is suggested', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('ct-choice-wrong', 'Choice wrong', [choiceCard]));
		await page.goto('/study/ct-choice-wrong');
		await page.locator('.choice', { hasText: 'Type 1' }).click();

		await expect(page.locator('.result')).toHaveText('Not quite.');
		await expect(page.locator('.choice--wrong')).toContainText('Type 1');
		await expect(page.locator('.choice--wrong')).toContainText('✗ Your answer');
		await expect(page.locator('.choice--right')).toContainText('Type 2');
		await expect(page.locator('.choice')).toHaveCount(4);
		await expect(page.locator('.choice').first()).toBeDisabled();
		await expect(page.locator('.grade--1')).toBeFocused();

		await page.keyboard.press('2');
		await expectAgainInLearning(page);
		await page.keyboard.press('1');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
		await expect(page.locator('.done')).toContainText('1 Hard');
	});

	test('the options keep their order when the page is reloaded', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-choice-order', 'Choice order', [choiceCard]));
		await page.goto('/study/ct-choice-order');
		await expect(page.locator('.choice')).toHaveCount(4);
		const before = await page.locator('.choice__text').allTextContents();
		await page.reload();
		await expect(page.locator('.choice')).toHaveCount(4);
		expect(await page.locator('.choice__text').allTextContents()).toEqual(before);
	});

	test('a number key past the last option does nothing', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-choice-keys', 'Choice keys', [choiceCard]));
		await page.goto('/study/ct-choice-keys');
		await page.keyboard.press('7');
		await page.keyboard.press('0');
		await expect(page.locator('.result')).toHaveCount(0);
		await expect(page.locator('.choice').first()).toBeEnabled();
	});

	test('"I don’t know" shows the right answer and suggests Again', async ({ page, request }) => {
		await importViaApi(request, deckOf('ct-choice-skip', 'Choice skip', [choiceCard]));
		await page.goto('/study/ct-choice-skip');
		await page.getByRole('button', { name: 'I don’t know' }).click();
		await expect(page.locator('.result')).toHaveText('You did not choose an answer.');
		await expect(page.locator('.choice--right')).toContainText('Type 2');
		await expect(page.locator('.choice--wrong')).toHaveCount(0);
		await expect(page.locator('.grade--1')).toBeFocused();
	});

	test('a link in an option is shown as text, so no control sits inside a button', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('ct-choice-link', 'Choice link', [
				{
					id: 'l1',
					type: 'choice',
					front: 'Which is documented?',
					choices: ['see [the RFC](https://example.com/rfc)', 'run `show ip route`'],
					correct: 0
				}
			])
		);
		await page.goto('/study/ct-choice-link');
		await expect(page.locator('.choice a')).toHaveCount(0);
		await expect(page.locator('.choice', { hasText: 'see the RFC' })).toBeVisible();
		await expect(page.locator('.choice code')).toHaveText('show ip route');
	});
});

test.describe('cloze cards', () => {
	test('each blank is studied on its own, and the other blank waits until another day', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('ct-cloze', 'Cloze', [
				{
					id: 'z1',
					type: 'cloze',
					text: 'The {{c1::DR}} is elected by highest {{c2::priority}}.',
					extra: 'Ties go to router ID.'
				}
			])
		);
		await page.goto('/study/ct-cloze');
		await expect(page.locator('.card__meta')).toContainText('Fill in the blank');
		await expect(page.locator('.card__front')).toContainText('[…]');
		await expect(page.locator('.card__back')).toHaveCount(0);

		await page.keyboard.press('Space');
		await expect(page.locator('.card__back strong')).toBeVisible();
		await expect(page.locator('.card__back')).toContainText('Ties go to router ID.');
		await expect(page.locator('.result')).toHaveCount(0);
		await expect(page.locator('.suggest')).toHaveCount(0);
		await expect(page.locator('.grade--suggested')).toHaveCount(0);
		await expect(page.locator('.grade--3')).toBeFocused();

		await page.keyboard.press('3');
		// The same blank comes back in its learning step. The other blank is held back for the day, so it is
		// not asked even though nothing else is due.
		await expectAgainInLearning(page);
		await expect(page.locator('.card__front')).toContainText('priority');
		await expect(page.locator('.card__front')).not.toContainText('elected by highest […]');
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`accessibility, ${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('typed card: question, wrong result, and right result', async ({ page, request }) => {
			await importViaApi(
				request,
				deckOf(`ct-a11y-typed-${scheme}`, 'A11y typed', [typedCard, { ...typedCard, id: 't2' }])
			);
			await page.goto(`/study/ct-a11y-typed-${scheme}`);
			await expect(page.getByLabel('Your answer')).toBeFocused();
			await scan(page, 'typed question');

			await page.getByLabel('Your answer').fill('nope');
			await page.keyboard.press('Enter');
			await expect(page.locator('.result')).toBeVisible();
			await scan(page, 'typed wrong');
		});

		test('choice card: question and answered', async ({ page, request }) => {
			await importViaApi(request, deckOf(`ct-a11y-choice-${scheme}`, 'A11y choice', [choiceCard]));
			await page.goto(`/study/ct-a11y-choice-${scheme}`);
			await expect(page.locator('.choice')).toHaveCount(4);
			await scan(page, 'choice question');

			await page.locator('.choice', { hasText: 'Type 1' }).click();
			await expect(page.locator('.result')).toBeVisible();
			await scan(page, 'choice answered wrong');
		});
	});
}

test.describe('small screens', () => {
	test.use({ viewport: { width: 320, height: 800 } });
	const long = 'extraordinarily'.repeat(20);

	test('a typed card with long text fits, before and after answering', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('ct-fit-typed', 'Fit typed', [{ id: 'f1', type: 'typed', front: long, answer: long }])
		);
		await page.goto('/study/ct-fit-typed');
		await expect(page.getByLabel('Your answer')).toBeVisible();
		expect(await scrollsHorizontally(page), 'question').toBe(false);

		await page.getByLabel('Your answer').fill(`${long}${long}`);
		await page.keyboard.press('Enter');
		await expect(page.locator('.result')).toBeVisible();
		expect(await scrollsHorizontally(page), 'answered').toBe(false);
	});

	test('a choice card with long options fits, before and after answering', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('ct-fit-choice', 'Fit choice', [
				{
					id: 'f2',
					type: 'choice',
					front: long,
					choices: [long, `${long} two`, 'short'],
					correct: 2,
					explanation: long
				}
			])
		);
		await page.goto('/study/ct-fit-choice');
		await expect(page.locator('.choice')).toHaveCount(3);
		expect(await scrollsHorizontally(page), 'question').toBe(false);

		await page.locator('.choice').first().click();
		await expect(page.locator('.result')).toBeVisible();
		expect(await scrollsHorizontally(page), 'answered').toBe(false);
	});
});
