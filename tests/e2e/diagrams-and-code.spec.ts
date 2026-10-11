import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { deckOf, importViaApi, scrollsHorizontally } from './helpers.ts';

// Mermaid diagrams and Shiki code highlighting, in a real browser under the real Content-Security-Policy
// (M2-11, ADR-010). The policy is not relaxed for them. These tests prove they work without that, and that
// hostile card text cannot use either one to run code.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scan(page: Page, label: string) {
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const summary = results.violations.map(
		(v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
	);
	expect(summary, label).toEqual([]);
}

interface Watch {
	violations: string[];
	foreignRequests: string[];
	jsBytes: () => number;
	dialogs: string[];
}

// Records policy violations, requests to other hosts, dialogs, and how much script was downloaded.
async function watch(page: Page): Promise<Watch> {
	const seen: Watch = { violations: [], foreignRequests: [], dialogs: [], jsBytes: () => 0 };
	await page.addInitScript(() => {
		(window as unknown as { __csp: string[] }).__csp = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			(window as unknown as { __csp: string[] }).__csp.push(
				`${event.violatedDirective} ${event.blockedURI}`
			);
		});
	});
	page.on('console', (message) => {
		if (/Content Security Policy|Refused to/i.test(message.text())) {
			seen.violations.push(message.text());
		}
	});
	page.on('dialog', (dialog) => {
		seen.dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	let bytes = 0;
	const pending: Promise<void>[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) {
			seen.foreignRequests.push(request.url());
		}
	});
	page.on('response', (response) => {
		if (response.url().endsWith('.js')) {
			pending.push(
				response
					.body()
					.then((body) => {
						bytes += body.length;
					})
					.catch(() => undefined)
			);
		}
	});
	seen.jsBytes = () => bytes;
	return seen;
}

const violationsIn = (page: Page) =>
	page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

const FLOW =
	'flowchart LR\n  A[Router A] --> B{Is DR?}\n  B -- yes --> C[Elect BDR]\n  B -- no --> D[Wait]';

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

test.describe('diagrams', () => {
	test('a mermaid fence is drawn as an image under the unchanged policy', async ({
		page,
		request
	}) => {
		const seen = await watch(page);
		await importViaApi(
			request,
			deckOf('dg-flow', 'Diagram', [
				{
					id: 'd1',
					type: 'basic',
					front: `How does OSPF choose a DR?\n\n${fence('mermaid', FLOW)}`,
					back: 'Highest priority wins.'
				}
			])
		);
		await page.goto('/study/dg-flow');

		const image = page.locator('figure.diagram img.diagram__image');
		await expect(image).toBeVisible();
		await expect
			.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15000 })
			.toBeGreaterThan(100);
		expect(await image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
		await expect(image).toHaveAttribute('alt', /Diagram/);

		// The source is there for reading, copying, and screen readers.
		await page.getByText('Diagram source').click();
		await expect(page.locator('.diagram__source pre')).toHaveText(FLOW);

		expect(await violationsIn(page), 'policy violations').toEqual([]);
		expect(seen.violations).toEqual([]);
		expect(seen.foreignRequests).toEqual([]);

		// The card can still be answered.
		await page.keyboard.press('Space');
		await expect(page.locator('.card__back')).toContainText('Highest priority wins.');
	});

	test('the policy header has no eval and no WebAssembly allowance', async ({ request }) => {
		const response = await request.get('/');
		const policy = response.headers()['content-security-policy'] ?? '';
		expect(policy).toContain("script-src 'self'");
		expect(policy).not.toMatch(/unsafe-eval|wasm-unsafe-eval|unsafe-inline.*script-src/);
		const scriptDirective = /script-src[^;]*/.exec(policy)?.[0] ?? '';
		expect(scriptDirective).not.toContain('unsafe');
	});

	test('the diagram is drawn again for the other colour scheme', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('dg-theme', 'Diagram theme', [
				{ id: 'd1', type: 'basic', front: fence('mermaid', FLOW), back: 'x' }
			])
		);
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/study/dg-theme');
		const image = page.locator('figure.diagram img');
		await expect(image).toBeVisible();
		const light = await image.getAttribute('src');

		await page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(() => image.getAttribute('src'), { timeout: 15000 }).not.toBe(light);
	});

	test('a diagram with a mistake shows its source with a note, and the card still works', async ({
		page,
		request
	}) => {
		await importViaApi(
			request,
			deckOf('dg-bad', 'Bad diagram', [
				{
					id: 'd1',
					type: 'basic',
					front: `Broken\n\n${fence('mermaid', 'flowchart LR\n  A --> -->')}`,
					back: 'Still here.'
				}
			])
		);
		await page.goto('/study/dg-bad');
		await expect(page.locator('.diagram-failed .md__badge')).toHaveText(
			'This diagram could not be drawn. Showing its source.'
		);
		await expect(page.locator('.diagram-failed pre')).toContainText('A --> -->');
		await page.keyboard.press('Space');
		await expect(page.locator('.card__back')).toContainText('Still here.');
		await page.keyboard.press('4');
		await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
	});

	test('a diagram over the size limit is refused quickly, not attempted', async ({
		page,
		request
	}) => {
		const huge = `flowchart LR\n${Array.from({ length: 600 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`;
		expect(huge.length).toBeGreaterThan(8000);
		await importViaApi(
			request,
			deckOf('dg-huge', 'Huge diagram', [
				{ id: 'd1', type: 'basic', front: fence('mermaid', huge), back: 'x' }
			])
		);
		const started = Date.now();
		await page.goto('/study/dg-huge');
		await expect(page.locator('.diagram-failed')).toBeVisible({ timeout: 5000 });
		expect(Date.now() - started).toBeLessThan(5000);
		await expect(page.locator('.card')).toBeVisible();
	});

	test('hostile diagram text cannot run anything or reach another site', async ({
		page,
		request
	}) => {
		const seen = await watch(page);
		const hostile = [
			'flowchart LR',
			'  A["<img src=x onerror=window.__pwned=1>"] --> B["<script>window.__pwned=1</script>"]',
			'  C["<a href=javascript:window.__pwned=1>click</a>"] --> D["<iframe src=https://evil.example></iframe>"]',
			'  click A call alert(1)',
			'  click B href "javascript:window.__pwned=1"',
			'  style A fill:#f00,stroke:#000',
			'  classDef evil fill:url(https://evil.example/x.png)',
			'  class A evil'
		].join('\n');
		await importViaApi(
			request,
			deckOf('dg-evil', 'Hostile diagram', [
				{ id: 'd1', type: 'basic', front: fence('mermaid', hostile), back: 'x' }
			])
		);
		await page.goto('/study/dg-evil');
		await expect(page.locator('figure.diagram img, .diagram-failed').first()).toBeVisible({
			timeout: 15000
		});
		await page.waitForTimeout(1000);

		expect(
			await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)
		).toBeUndefined();
		expect(seen.dialogs).toEqual([]);
		expect(seen.foreignRequests).toEqual([]);
		// Nothing from the diagram became part of the page.
		expect(
			await page
				.locator('.card iframe, .card script, .card [onerror], .card a[href^="javascript"]')
				.count()
		).toBe(0);
		expect(await page.locator('style:has-text("evil")').count()).toBe(0);
	});

	test('a wide diagram scrolls inside the card on a small screen', async ({ page, request }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		const wide = `flowchart LR\n${Array.from({ length: 12 }, (_, i) => `  S${i}[Step number ${i}] --> S${i + 1}[Step number ${i + 1}]`).join('\n')}`;
		await importViaApi(
			request,
			deckOf('dg-wide', 'Wide diagram', [
				{ id: 'd1', type: 'basic', front: fence('mermaid', wide), back: 'x' }
			])
		);
		await page.goto('/study/dg-wide');
		await expect(page.locator('figure.diagram img')).toBeVisible({ timeout: 15000 });
		expect(await scrollsHorizontally(page)).toBe(false);
	});
});

test.describe('code highlighting', () => {
	const TS = 'const total: number = items.reduce((a, b) => a + b.price, 0);\n// sum of prices';

	test('a known language is coloured and the text is exactly as written', async ({
		page,
		request
	}) => {
		const seen = await watch(page);
		await importViaApi(
			request,
			deckOf('hl-ts', 'Highlight', [
				{ id: 'h1', type: 'basic', front: `What does this do?\n\n${fence('ts', TS)}`, back: 'x' }
			])
		);
		await page.goto('/study/hl-ts');
		const code = page.locator('.card__front pre code.shiki');
		await expect(code).toBeVisible();
		expect(await code.locator('span.tk').count()).toBeGreaterThan(8);
		expect(await code.evaluate((el) => el.textContent)).toBe(TS + '\n'.slice(0, 0));
		// Two different token colours, so it is not just plain text in spans.
		const colours = await code
			.locator('span.tk')
			.evaluateAll((spans) => new Set(spans.map((s) => getComputedStyle(s).color)).size);
		expect(colours).toBeGreaterThan(2);
		expect(await violationsIn(page)).toEqual([]);
		expect(seen.violations).toEqual([]);
		expect(seen.foreignRequests).toEqual([]);
	});

	test('a language that is not known stays plain', async ({ page, request }) => {
		await importViaApi(
			request,
			deckOf('hl-plain', 'Plain', [
				{ id: 'h1', type: 'basic', front: fence('cobol', 'DISPLAY "HI".'), back: 'x' }
			])
		);
		await page.goto('/study/hl-plain');
		await expect(page.locator('.card__front pre code')).toHaveText('DISPLAY "HI".');
		expect(await page.locator('.card__front pre code span').count()).toBe(0);
	});

	test('code that looks like markup stays text', async ({ page, request }) => {
		const evil = '<script>window.__pwned=1</script>\n<img src=x onerror="window.__pwned=1">';
		await importViaApi(
			request,
			deckOf('hl-evil', 'Evil code', [
				{ id: 'h1', type: 'basic', front: fence('html', evil), back: 'x' }
			])
		);
		await page.goto('/study/hl-evil');
		await expect(page.locator('.card__front code.shiki')).toBeVisible();
		expect(await page.locator('.card__front code').evaluate((el) => el.textContent)).toBe(evil);
		expect(await page.locator('.card__front code img, .card__front code script').count()).toBe(0);
		expect(
			await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)
		).toBeUndefined();
	});

	test('the highlighter and Mermaid are not downloaded for a card without a code fence', async ({
		page,
		request
	}) => {
		const plain = await watch(page);
		await importViaApi(
			request,
			deckOf('lz-plain', 'Lazy plain', [
				{ id: 'p1', type: 'basic', front: 'Just `inline` text and **bold**.', back: 'x' }
			])
		);
		await page.goto('/study/lz-plain');
		await expect(page.locator('.card__front')).toContainText('Just inline text');
		await page.waitForLoadState('networkidle');
		const plainBytes = plain.jsBytes();

		const page2 = await page.context().newPage();
		const diagram = await watch(page2);
		await importViaApi(
			request,
			deckOf('lz-diagram', 'Lazy diagram', [
				{ id: 'p1', type: 'basic', front: fence('mermaid', FLOW), back: 'x' }
			])
		);
		await page2.goto('/study/lz-diagram');
		await expect(page2.locator('figure.diagram img')).toBeVisible({ timeout: 15000 });
		await page2.waitForLoadState('networkidle');
		const diagramBytes = diagram.jsBytes();
		await page2.close();

		// The diagram library is hundreds of kilobytes. Without a diagram the page must not pay for it.
		expect(diagramBytes - plainBytes).toBeGreaterThan(500_000);
		expect(plainBytes).toBeLessThan(600_000);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`highlighted code and a diagram pass the accessibility checks in the ${scheme} theme`, async ({
			page,
			request
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await importViaApi(
				request,
				deckOf(`hl-a11y-${scheme}`, 'A11y code', [
					{
						id: 'h1',
						type: 'basic',
						front: [
							fence('ts', TS),
							fence(
								'python',
								'def total(items):\n    # sum the prices\n    return sum(i.price for i in items)'
							),
							fence('bash', 'show ip ospf neighbor | include FULL # who is full'),
							fence('yaml', 'name: demo\nitems:\n  - a: "1"\n  - b: true'),
							fence('json', '{"id": "x", "n": 3, "ok": null}'),
							fence('powershell', 'Get-Service | Where-Object Status -eq "Running"'),
							fence('sql', 'SELECT id, name FROM users WHERE active = 1; -- active only'),
							fence('mermaid', FLOW)
						].join('\n\n'),
						back: 'x'
					}
				])
			);
			await page.goto(`/study/hl-a11y-${scheme}`);
			await expect(page.locator('.card__front code.shiki')).toHaveCount(7, { timeout: 15000 });
			await expect(page.locator('figure.diagram img')).toBeVisible({ timeout: 15000 });
			await scan(page, `code and diagram, ${scheme}`);
		});
	}
});
