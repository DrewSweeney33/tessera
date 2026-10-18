import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi } from './helpers.ts';

// The small-phone review of 2026-10-18: a heading that broke into pieces, an unstyled error page, charts that hid the
// newest weeks and gave touch no way to read a value, touch areas under 44 px, and a layout that ran off the screen at
// large text sizes. Each test pins one of those down.

const PHONES = [320, 375, 414];

// Text that sits to the right of the screen edge. The page is clipped sideways (so nothing scrolls), which means
// anything past the edge is simply lost. Decorative drawings and text for screen readers are skipped.
async function textPastTheEdge(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const edge = document.documentElement.clientWidth;
		const lost: string[] = [];
		for (const element of document.querySelectorAll('body *')) {
			if (element.closest('svg') || element.closest('.sr-only') || element.children.length > 0) {
				continue;
			}
			const style = getComputedStyle(element);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			const box = element.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) continue;
			if (box.right > edge + 1) {
				lost.push(
					`${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 30)}"`
				);
			}
		}
		return lost;
	});
}

async function largeText(page: Page) {
	// The root size is what a browser's own text-size setting changes, and every size in the app is in rem.
	await page.evaluate(() =>
		document.documentElement.style.setProperty('font-size', '200%', 'important')
	);
}

test.describe('the Decks heading', () => {
	for (const width of PHONES) {
		test(`stays on one line with the buttons under it at ${width}px`, async ({ page, request }) => {
			await importViaApi(request, deckOf('phone-head', 'Phone head', basicCards(2, 'ph')));
			await page.setViewportSize({ width, height: 800 });
			await page.goto('/');
			const heading = page.getByRole('heading', { name: 'Decks', level: 1 });
			await expect(heading).toBeVisible();
			const box = (await heading.boundingBox())!;
			const lineHeight = await heading.evaluate((element) =>
				parseFloat(getComputedStyle(element).lineHeight)
			);
			expect(box.height, 'the heading wrapped').toBeLessThan(lineHeight * 1.5);
			const newDeck = (await page
				.getByRole('link', { name: 'New deck', exact: true })
				.boundingBox())!;
			expect(newDeck.y, 'the buttons sit under the title').toBeGreaterThanOrEqual(
				box.y + box.height - 1
			);
		});
	}
});

test.describe('an address that does not exist', () => {
	test('shows Tessera’s own page with a way back', async ({ page }) => {
		await page.goto('/no-such-page');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('That page does not exist');
		await expect(page).toHaveTitle(/That page does not exist/);
		await expect(page.getByRole('navigation').first()).toBeVisible();
		await page.getByRole('link', { name: 'Back to decks' }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
	});

	test('passes the accessibility scan on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/no-such-page');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
			.analyze();
		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});

test.describe('Statistics on a phone', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
	});

	test('the calendar opens on the newest weeks, scrolls by keyboard, and a tap reads a day', async ({
		page
	}) => {
		await page.goto('/stats');
		const region = page.getByRole('region', { name: /scrolls sideways/ });
		await expect(region).toBeVisible();
		const atNewest = await region.evaluate(
			(element) =>
				element.scrollWidth > element.clientWidth &&
				Math.abs(element.scrollLeft + element.clientWidth - element.scrollWidth) < 2
		);
		expect(atNewest, 'the newest weeks are on the right edge').toBe(true);

		await region.focus();
		await expect(region).toBeFocused();

		// Labels are drawn at least 11 px tall on the screen: the drawing is never scaled below its own size.
		const labelPx = await region.evaluate((element) => {
			const drawing = element.querySelector('svg')!;
			const label = drawing.querySelector('text')!;
			return (
				parseFloat(getComputedStyle(label).fontSize) *
				(drawing.getBoundingClientRect().width / drawing.viewBox.baseVal.width)
			);
		});
		expect(labelPx).toBeGreaterThanOrEqual(11.5);

		const figure = page.locator('figure').filter({ has: region });
		await expect(figure.getByText('Tap a day to see its reviews.')).toBeVisible();
		await region.locator('rect[data-day]').last().click();
		await expect(figure.locator('.readout')).toContainText(/\d+ reviews?/);
	});

	test('a tap on a bar reads that day', async ({ page }) => {
		await page.goto('/stats');
		const figure = page.locator('figure').first();
		const drawing = figure.locator('svg').first();
		await expect(figure.getByText('Tap a bar to see that day.')).toBeVisible();
		// The chart is below the first screen, and a mouse click only lands on what is on screen.
		await drawing.scrollIntoViewIfNeeded();
		const box = (await drawing.boundingBox())!;
		await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
		await expect(figure.locator('.readout')).toContainText(/\d+ (reviews?|items?)/);
	});

	test('passes the accessibility scan at 320px, where the calendar scrolls', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/stats');
		await expect(page.getByRole('region', { name: /scrolls sideways/ })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
			.analyze();
		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});

test.describe('touch areas', () => {
	test('the way back on an inner page is at least 44 px tall', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		for (const path of ['/settings', '/leeches', '/backups', '/trash']) {
			await page.goto(path);
			const link = page.getByRole('link', { name: 'All decks' });
			await expect(link).toBeVisible();
			expect((await link.boundingBox())!.height, path).toBeGreaterThanOrEqual(44);
		}
	});
});

test.describe('large text', () => {
	const PAGES = ['/', '/stats', '/settings', '/leeches', '/import', '/decks/new', '/no-such-page'];

	for (const path of PAGES) {
		test(`${path} does not run off the screen at double text size on a 320px phone`, async ({
			page,
			request
		}) => {
			await importViaApi(request, deckOf('phone-big', 'Phone big', basicCards(2, 'pb')));
			await page.setViewportSize({ width: 320, height: 568 });
			await page.goto(path);
			await expect(page.locator('main')).toBeVisible();
			await largeText(page);
			expect(await textPastTheEdge(page)).toEqual([]);
		});
	}

	test('the tab bar keeps its labels at the normal size and trades them for icons at double size', async ({
		page
	}) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/settings');
		const label = page.locator('.tab__label').first();
		expect(
			(await label.boundingBox())!.width,
			'labels are shown at the normal size'
		).toBeGreaterThan(20);

		await largeText(page);
		await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
		const hidden = await label.boundingBox();
		expect(hidden!.width, 'labels are kept for screen readers only').toBeLessThanOrEqual(1);
		const tab = (await page.getByRole('link', { name: 'Decks' }).first().boundingBox())!;
		expect(tab.height).toBeGreaterThanOrEqual(44);
		expect(tab.width).toBeGreaterThanOrEqual(44);
	});
});

test.describe('the folder panel on a phone', () => {
	const JSON_HEADERS = { 'content-type': 'application/json' };
	let folderId: number | undefined;

	test.beforeEach(async ({ request }) => {
		await importViaApi(request, deckOf('phone-fold', 'Phone folder deck', basicCards(3, 'pf')));
		const made = await request.post('/api/folders', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ name: 'Phone folder' })
		});
		folderId = ((await made.json()) as { folder: { id: number } }).folder.id;
		await request.put('/api/folder-assignments', {
			headers: JSON_HEADERS,
			data: JSON.stringify({ deckIds: ['phone-fold'], folderId })
		});
	});

	test.afterEach(async ({ request }: { request: APIRequestContext }) => {
		if (folderId !== undefined) {
			await request.delete(`/api/folders/${folderId}`, { headers: JSON_HEADERS });
		}
	});

	for (const width of [320, 375]) {
		test(`has its actions in order and on one line each at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await page.goto('/');
			const folder = page.getByRole('region', { name: 'Phone folder' });
			await expect(folder).toBeVisible();

			const study = (await folder.getByRole('link', { name: /^Study folder/ }).boundingBox())!;
			const practice = folder.getByRole('link', { name: /^Practice folder/ });
			const stats = folder.getByRole('button', { name: /^Statistics for/ });
			const edit = folder.getByRole('button', { name: /^Edit folder/ });
			const remove = folder.getByRole('button', { name: /^Delete folder/ });
			const boxes = {
				practice: (await practice.boundingBox())!,
				stats: (await stats.boundingBox())!,
				edit: (await edit.boundingBox())!,
				remove: (await remove.boundingBox())!
			};

			// Study is on its own line, first and widest; Edit and Delete come after the other two.
			expect(boxes.practice.y).toBeGreaterThan(study.y + study.height - 1);
			expect(boxes.stats.y).toBeGreaterThan(study.y + study.height - 1);
			expect(study.width).toBeGreaterThanOrEqual(boxes.practice.width);
			expect(boxes.edit.y).toBeGreaterThanOrEqual(boxes.practice.y);
			expect(
				boxes.remove.x + boxes.remove.width,
				'Delete is pinned to the right edge'
			).toBeGreaterThanOrEqual(study.x + study.width - 1);

			// A label is never squeezed onto two lines.
			for (const control of [practice, stats, edit, remove]) {
				const lines = await control.evaluate((element) => {
					const range = document.createRange();
					const texts = [...element.querySelectorAll('*'), element].flatMap((node) =>
						[...node.childNodes].filter(
							(child) => child.nodeType === 3 && child.textContent?.trim()
						)
					);
					const tops = texts.flatMap((text) => {
						range.selectNodeContents(text);
						return [...range.getClientRects()].map((rect) => Math.round(rect.top));
					});
					return new Set(tops).size;
				});
				expect(lines).toBe(1);
			}
		});
	}

	test('shows the decks inside it as plain rows, not tiles in a tile', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 800 });
		await page.goto('/');
		const row = page.getByRole('region', { name: 'Phone folder' }).locator('.decks > .row').first();
		await expect(row).toBeVisible();
		const style = await row.evaluate((element) => {
			const computed = getComputedStyle(element);
			return { shadow: computed.boxShadow, radius: computed.borderTopLeftRadius };
		});
		expect(style.shadow).toBe('none');
		expect(style.radius).toBe('0px');
	});
});
