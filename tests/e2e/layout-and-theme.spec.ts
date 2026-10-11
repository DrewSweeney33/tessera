import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

const WIDTHS = [320, 375, 414, 768];

// Clickable text must stay on one line (Hallmark gate 49). Each text node inside a control is
// measured: if it wrapped, its client rects start at different heights.
async function wrappedControls(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const wrapped: string[] = [];
		const controls = document.querySelectorAll('.btn, nav a, .back, .row__action a');
		for (const control of controls) {
			const style = getComputedStyle(control);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (!node.textContent?.trim()) continue;
				const parent = node.parentElement;
				if (!parent || getComputedStyle(parent).display === 'none') continue;
				const range = document.createRange();
				range.selectNodeContents(node);
				const tops = [...range.getClientRects()].map((rect) => rect.top);
				const fontSize = parseFloat(getComputedStyle(parent).fontSize);
				if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > fontSize * 0.8) {
					wrapped.push(`"${node.textContent.trim()}" in .${control.className}`);
				}
			}
		}
		return wrapped;
	});
}

test.describe('no sideways scroll and no wrapped buttons', () => {
	test.beforeAll(async ({ request }) => {
		await importViaApi(
			request,
			deckOf('layout-deck', 'A deck with a rather long title to test how the ledger row wraps', [
				...basicCards(6, 'lay'),
				{
					id: 'lay-cloze',
					type: 'cloze',
					text: 'The {{c1::OSPF}} cost is {{c2::reference bandwidth divided by interface bandwidth}}.'
				}
			])
		);
	});

	for (const width of WIDTHS) {
		test(`at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });

			for (const path of ['/', '/import', '/study/layout-deck']) {
				await page.goto(path);
				await expect(page.locator('main')).toBeVisible();
				if (path.startsWith('/study')) {
					await expect(page.locator('.card')).toBeVisible();
					expect(await scrollsHorizontally(page), `${path} front`).toBe(false);
					expect(await wrappedControls(page), `${path} front controls`).toEqual([]);
					await page.keyboard.press('Space');
					await expect(page.getByRole('group', { name: /How well/ })).toBeVisible();
				}
				expect(await scrollsHorizontally(page), path).toBe(false);
				expect(await wrappedControls(page), `${path} controls`).toEqual([]);
			}
		});
	}

	test('a re-import preview with open diffs of very long unbroken text fits at 320px', async ({
		page,
		request
	}) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await importViaApi(request, deckOf('fit-diff', 'Fit diff', basicCards(2, 'fd')));
		await page.goto('/import');
		const long = 'x'.repeat(400);
		const revised = [
			{ id: 'fd-1', type: 'basic' as const, front: long, back: long },
			{ id: `fd-${long}`.slice(0, 60), type: 'basic' as const, front: 'new', back: 'new' }
		];
		await page
			.getByLabel('Deck (JSON or Markdown)')
			.fill(JSON.stringify(deckOf('fit-diff', 'Fit diff', revised)));
		await page.getByRole('button', { name: 'Preview' }).click();
		await page.getByText('Show what changes').first().click();
		await expect(page.locator('.diff').first()).toBeVisible();
		expect(await scrollsHorizontally(page), 'open diffs').toBe(false);
	});

	test('the import page with a preview and an error list fits at 320px', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/import');
		await page
			.getByLabel('Deck (JSON or Markdown)')
			.fill(JSON.stringify(deckOf('fit', 'Fit', basicCards(60, 'fit'))));
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.locator('.changes')).toBeVisible();
		expect(await scrollsHorizontally(page), 'preview').toBe(false);

		await page
			.getByLabel('Deck (JSON or Markdown)')
			.fill('{ "tessera": 1, "deck": { "id": "x", "title": "X" }, "cards": [{}] }');
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.locator('.problems')).toBeVisible();
		expect(await scrollsHorizontally(page), 'errors').toBe(false);
	});
});

test.describe('theme', () => {
	test('the choice persists across reloads and applies before the app loads', async ({ page }) => {
		await page.goto('/');
		const toggle = page.getByRole('button', { name: /^Theme:/ });
		await expect(toggle).toHaveAccessibleName(/Auto/);

		await toggle.click();
		await expect(toggle).toHaveAccessibleName(/Light/);
		await toggle.click();
		await expect(toggle).toHaveAccessibleName(/Dark/);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveAccessibleName(/Dark/);

		await page.getByRole('button', { name: /^Theme:/ }).click();
		await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
	});

	test('a saved dark choice is applied even if the app bundle never runs', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('tessera-theme', 'dark'));
		await page.route('**/_app/**', (route) => route.abort());
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('follows the system setting when set to auto', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/');
		const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		await page.emulateMedia({ colorScheme: 'light' });
		const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(dark).not.toBe(light);
	});

	test('keeps working when storage is blocked', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'localStorage', {
				get() {
					throw new DOMException('blocked', 'SecurityError');
				}
			});
		});
		await page.goto('/');
		await page.getByRole('button', { name: /^Theme:/ }).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	});
});
