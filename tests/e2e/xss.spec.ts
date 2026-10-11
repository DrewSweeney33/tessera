import { expect, test, type Page } from '@playwright/test';
import { XSS_CORPUS, chunks } from './xss-corpus.ts';
import { deckOf, importViaApi, type TestCard } from './helpers.ts';

declare global {
	interface Window {
		__pwned?: unknown;
	}
}

// Anything dangerous inside rendered card text. Our own controls (hint button, grade buttons) sit
// outside the .md containers, so a forbidden element inside .md is always hostile content.
async function problemsInRenderedText(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const problems: string[] = [];
		const forbiddenTags = new Set([
			'script',
			'iframe',
			'frame',
			'object',
			'embed',
			'img',
			'svg',
			'math',
			'form',
			'input',
			'button',
			'select',
			'textarea',
			'style',
			'link',
			'meta',
			'video',
			'audio',
			'source',
			'base'
		]);
		const urlAttributes = ['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc', 'data'];
		for (const root of document.querySelectorAll('.md')) {
			for (const el of root.querySelectorAll('*')) {
				const tag = el.tagName.toLowerCase();
				if (forbiddenTags.has(tag)) problems.push(`forbidden element <${tag}>`);
				for (const attr of el.attributes) {
					const name = attr.name.toLowerCase();
					if (name.startsWith('on')) problems.push(`event handler ${name} on <${tag}>`);
					if (name === 'style') problems.push(`style attribute on <${tag}>`);
					if (urlAttributes.includes(name) && /^\s*(javascript|data|vbscript):/i.test(attr.value)) {
						problems.push(`${name}="${attr.value}" on <${tag}>`);
					}
				}
				if (tag === 'a') {
					const href = el.getAttribute('href') ?? '';
					if (!/^(https?:|mailto:|#|\?|\.{1,2}\/|\/(?!\/))/i.test(href))
						problems.push(`unsafe link ${href}`);
					if (!(el.getAttribute('rel') ?? '').includes('noopener'))
						problems.push(`link without noopener: ${href}`);
				}
			}
		}
		return problems;
	});
}

for (const [index, group] of chunks(XSS_CORPUS).entries()) {
	test(`hostile card text never runs or injects markup (group ${index + 1})`, async ({
		page,
		request
	}) => {
		const deckId = `xss-${index + 1}`;
		const cards: TestCard[] = group.map((payload, i) => ({
			id: `x${i}`,
			type: 'basic',
			front: `Front ${i}\n\n${payload.markdown}`,
			back: `Back ${i}\n\n${payload.markdown}`,
			hint: payload.markdown
		}));
		await importViaApi(request, deckOf(deckId, `XSS corpus ${index + 1}`, cards));

		const dialogs: string[] = [];
		const popups: string[] = [];
		const pageErrors: string[] = [];
		page.on('dialog', (dialog) => {
			dialogs.push(dialog.message());
			void dialog.dismiss();
		});
		page.on('popup', (popup) => popups.push(popup.url()));
		page.on('pageerror', (error) => pageErrors.push(error.message));

		await page.goto(`/study/${deckId}`);

		for (const [i, payload] of group.entries()) {
			const label = `payload "${payload.name}"`;
			await expect(page.locator('.card__front')).toContainText(`Front ${i}`);

			if (payload.visible) {
				await expect(page.locator('.card__front'), `${label} should show as text`).toContainText(
					payload.visible
				);
			}
			expect(await problemsInRenderedText(page), `${label} (question)`).toEqual([]);

			await page.keyboard.press('h');
			await expect(page.locator('.hint')).toBeVisible();
			expect(await problemsInRenderedText(page), `${label} (hint)`).toEqual([]);

			await page.keyboard.press('Space');
			await expect(page.locator('.card__back')).toContainText(`Back ${i}`);
			expect(await problemsInRenderedText(page), `${label} (answer)`).toEqual([]);
			expect(await page.evaluate(() => window.__pwned), `${label} executed script`).toBeUndefined();

			await page.keyboard.press('3');
		}

		expect(dialogs, 'no alert, confirm, or prompt dialogs').toEqual([]);
		expect(popups, 'no popups').toEqual([]);
		expect(pageErrors, 'no uncaught page errors').toEqual([]);
		expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
	});
}

test('links in card text open safely and unsafe protocols are dropped', async ({
	page,
	request
}) => {
	await importViaApi(
		request,
		deckOf('links', 'Links', [
			{
				id: 'l1',
				type: 'basic',
				front:
					'See [the docs](https://example.com/docs) or [mail](mailto:a@example.com) or [local](/import) or [bad](javascript:alert(1)).',
				back: 'ok'
			}
		])
	);
	await page.goto('/study/links');
	const links = page.locator('.card__front a');
	await expect(links).toHaveCount(3);
	for (const link of await links.all()) {
		await expect(link).toHaveAttribute('rel', /noopener/);
		await expect(link).toHaveAttribute('target', '_blank');
	}
	await expect(page.locator('.card__front')).toContainText('bad');
	await expect(page.locator('.card__front a[href^="javascript"]')).toHaveCount(0);
});

test('a card with broken formatting still shows and can be graded', async ({ page, request }) => {
	await importViaApi(
		request,
		deckOf('plain', 'Plain', [
			{ id: 'p1', type: 'basic', front: 'A | table | that\n|---|\nis <unclosed', back: 'fine' }
		])
	);
	await page.goto('/study/plain');
	await expect(page.locator('.card')).toBeVisible();
	await page.keyboard.press('Space');
	await expect(page.locator('.card__back')).toContainText('fine');
	await page.keyboard.press('3');
	await expect(page.locator('.counts')).toBeVisible();
});
