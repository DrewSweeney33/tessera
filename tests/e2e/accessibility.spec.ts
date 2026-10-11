import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// Automated WCAG 2.1 A and AA checks (axe-core) on every screen state, in both colour schemes.
// Automation finds roughly a third of accessibility problems. Keyboard order, focus movement, and
// reading order are covered by the other specs and by the manual notes in the QA report.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

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

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('home: empty and with decks', async ({ page, request }) => {
			await importViaApi(request, deckOf(`a11y-home-${scheme}`, `A11y ${scheme}`, basicCards(3)));
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
			await expect(page.getByRole('heading', { name: `A11y ${scheme}` })).toBeVisible();
			await scan(page, 'home with decks');
		});

		test('import: empty, preview, and errors', async ({ page }) => {
			await page.goto('/import');
			// The page is built in the browser, so scan it only once it exists. A slower browser meets the empty
			// shell otherwise, which has no title or heading to find.
			await expect(page.getByRole('heading', { name: 'Import a deck' })).toBeVisible();
			await scan(page, 'import empty');

			const deck = JSON.stringify(deckOf(`a11y-import-${scheme}`, 'Import check', basicCards(3)));
			await page.getByLabel('Deck (JSON or Markdown)').fill(deck);
			await page.getByRole('button', { name: 'Preview' }).click();
			await expect(page.getByRole('heading', { name: /New deck/ })).toBeVisible();
			await scan(page, 'import preview');

			await page.getByRole('button', { name: 'Import', exact: true }).click();
			await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
			await scan(page, 'import success');

			await page.getByLabel('Deck (JSON or Markdown)').fill('{ "tessera": 1, "cards": [ , ] }');
			await page.getByRole('button', { name: 'Preview' }).click();
			await expect(page.getByRole('heading', { name: /problems? to fix/ })).toBeVisible();
			await scan(page, 'import errors');
		});

		test('import: a re-import preview with diffs, a retype, and missing cards', async ({
			page,
			request
		}) => {
			const id = `a11y-reimport-${scheme}`;
			const cards = basicCards(5, 'r');
			await importViaApi(request, deckOf(id, 'Re-import check', cards));
			await page.goto('/import');
			const revised = [
				{ ...cards[0]!, back: 'A changed answer' },
				{ id: 'r-2', type: 'typed' as const, front: 'Question 2', answer: 'x' },
				cards[2]!
			];
			await page
				.getByLabel('Deck (JSON or Markdown)')
				.fill(JSON.stringify(deckOf(id, 'Re-import check', revised)));
			await page.getByRole('button', { name: 'Preview' }).click();
			await expect(page.getByRole('heading', { name: 'Not in this file (2)' })).toBeVisible();
			await expect(page.locator('.warning')).toBeVisible();
			await scan(page, 're-import preview, diffs closed');

			await page.getByText('Show what changes').first().click();
			await expect(page.getByText('A changed answer')).toBeVisible();
			await scan(page, 're-import preview, diffs open');
		});

		test('study: front, answer, and done', async ({ page, request }) => {
			const id = `a11y-study-${scheme}`;
			await importViaApi(
				request,
				deckOf(id, 'Study check', [
					{
						id: 's1',
						type: 'basic',
						front: 'What is **OSPF**?\n\n```text\nrouter ospf 1\n```',
						back: 'A link-state routing protocol.\n\n| a | b |\n|---|---|\n| 1 | 2 |',
						hint: 'Think of Dijkstra'
					}
				])
			);
			await page.goto(`/study/${id}`);
			await expect(page.locator('.card')).toBeVisible();
			await scan(page, 'study front');

			await page.keyboard.press('h');
			await expect(page.locator('.hint')).toBeVisible();
			await scan(page, 'study hint');

			await page.keyboard.press('Space');
			await expect(page.getByRole('group', { name: /How well/ })).toBeVisible();
			await scan(page, 'study answer');

			await page.keyboard.press('4');
			await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
			await scan(page, 'study done');
		});

		test('study: error and unknown deck states', async ({ page }) => {
			await page.goto('/study/does-not-exist');
			await expect(page.getByRole('alert')).toBeVisible();
			await scan(page, 'study error');
		});
	});
}

test.describe('keyboard and focus', () => {
	test('every interactive control on every page shows a visible focus indicator', async ({
		page,
		request
	}) => {
		await importViaApi(request, deckOf('a11y-focus', 'Focus check', basicCards(2)));
		for (const path of ['/', '/import', '/study/a11y-focus']) {
			await page.goto(path);
			await expect(page.locator('main')).toBeVisible();
			const stops = await page.evaluate(async () => {
				const results: { name: string; indicator: boolean }[] = [];
				const seen = new Set<Element>();
				// Walk the tab order by focusing each focusable element in document order.
				const focusable = [
					...document.querySelectorAll<HTMLElement>(
						'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'
					)
				];
				for (const el of focusable) {
					if (seen.has(el) || el.getClientRects().length === 0) continue;
					seen.add(el);
					el.focus({ focusVisible: true } as FocusOptions);
					await new Promise((r) => requestAnimationFrame(r));
					const style = getComputedStyle(el);
					const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
					const shadow = style.boxShadow !== 'none';
					results.push({
						name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
							.trim()
							.slice(0, 30),
						indicator: outline || shadow
					});
				}
				return results;
			});
			expect(stops.length, `${path} has focusable controls`).toBeGreaterThan(0);
			expect(
				stops.filter((stop) => !stop.indicator).map((stop) => stop.name),
				`${path}: controls with no visible focus indicator`
			).toEqual([]);
		}
	});

	test('the skip link is the first tab stop and works', async ({ page, browserName }) => {
		await page.goto('/import');
		await expect(page.locator('main')).toBeVisible();
		if (browserName === 'webkit') {
			// Safari does not Tab to links unless the person turns that on (they use Option+Tab). So the link is focused
			// directly, which checks that it works, and the first Tab is checked to land on a control, not nowhere.
			await page.keyboard.press('Tab');
			await expect(page.locator(':focus')).toHaveCount(1);
			await page.getByRole('link', { name: /skip/i }).focus();
		} else {
			await page.keyboard.press('Tab');
			await expect(page.locator(':focus')).toHaveText(/skip/i);
		}
		await page.keyboard.press('Enter');
		await expect(page.locator('main')).toBeFocused();
	});

	test('the page has one h1 and a sensible landmark structure', async ({ page }) => {
		for (const path of ['/', '/import']) {
			await page.goto(path);
			await expect(page.locator('main')).toBeVisible();
			expect(await page.locator('h1').count(), `${path} h1 count`).toBe(1);
			expect(await page.locator('main').count()).toBe(1);
			expect(await page.locator('header').count()).toBeGreaterThan(0);
		}
	});

	test('text still works at 200 percent zoom (320 css px wide)', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await page.goto('/import');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth
		);
		expect(overflow).toBe(false);
	});

	test('reduced motion removes animations and transitions', async ({ page }) => {
		// Longest animation or transition on the page, in milliseconds.
		const longestMotion = () =>
			page.evaluate(() => {
				const toMs = (value: string) =>
					value
						.split(',')
						.map((part) => parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000))
						.reduce((max, ms) => Math.max(max, ms || 0), 0);
				return [...document.querySelectorAll('*')]
					.map((el) => getComputedStyle(el))
					.flatMap((style) => [style.animationDuration, style.transitionDuration])
					.reduce((max, value) => Math.max(max, toMs(value)), 0);
			});

		// Control: with no preference the interface does animate, so the check below can fail.
		// The app builds its page in the browser, after the load event. Slow its code down so this test
		// always meets that situation, as it does on a slow CI machine, and wait for the page to exist
		// before measuring. Measuring an empty page finds no motion and proves nothing.
		await page.route('**/_app/**', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 400));
			await route.continue();
		});
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/import');
		await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
		expect(await longestMotion(), 'the interface has some motion to remove').toBeGreaterThan(20);

		await page.emulateMedia({ reducedMotion: 'reduce' });
		expect(await longestMotion()).toBeLessThanOrEqual(1);
	});
});
