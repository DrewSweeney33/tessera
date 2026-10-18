import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { basicCards, deckOf, importViaApi, makeLeech } from './helpers.ts';

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

		test('home: folders, the folder statistics, the move bar, and the folder forms', async ({
			page,
			request
		}) => {
			const json = { 'content-type': 'application/json' };
			const one = `a11y-folder-${scheme}-one`;
			const two = `a11y-folder-${scheme}-two`;
			await importViaApi(request, deckOf(one, `A11y folder ${scheme} one`, basicCards(2)));
			await importViaApi(request, deckOf(two, `A11y folder ${scheme} two`, basicCards(2)));
			const made = await request.post('/api/folders', {
				headers: json,
				data: JSON.stringify({ name: `A11y folder ${scheme}` })
			});
			const folder = ((await made.json()) as { folder: { id: number } }).folder;
			await request.put('/api/folder-assignments', {
				headers: json,
				data: JSON.stringify({ deckIds: [one], folderId: folder.id })
			});
			try {
				await page.goto('/');
				await expect(
					page.getByRole('heading', { name: `A11y folder ${scheme}`, level: 2, exact: true })
				).toBeVisible();
				await scan(page, 'home with a folder and ungrouped decks');

				await page.getByRole('button', { name: `Statistics for A11y folder ${scheme}` }).click();
				await expect(page.getByText('Reviews today').first()).toBeVisible();
				await scan(page, 'home with the folder statistics open');

				await page.getByRole('button', { name: 'New folder' }).click();
				await page.getByRole('button', { name: 'Create folder' }).click();
				await expect(
					page.getByRole('alert').filter({ hasText: 'Give the folder a name.' })
				).toBeVisible();
				await scan(page, 'home with the new folder form and a problem');
				await page.getByRole('button', { name: 'Cancel' }).click();

				await page.getByRole('button', { name: `Edit folder A11y folder ${scheme}` }).click();
				await scan(page, 'home with the rename form');
				await page.getByRole('button', { name: 'Cancel' }).click();

				await page.getByRole('button', { name: `Delete folder A11y folder ${scheme}` }).click();
				await scan(page, 'home with the delete folder question');
				await page.getByRole('button', { name: 'Keep folder' }).click();

				await page.getByRole('button', { name: 'Move decks' }).click();
				await page.getByLabel(`Select A11y folder ${scheme} two`).check();
				await scan(page, 'home while moving decks');
			} finally {
				await request.delete(`/api/folders/${folder.id}`, { headers: json });
			}
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

		test('import: several files, previewed, with a problem, and imported', async ({ page }) => {
			await page.goto('/import');
			await expect(page.getByRole('heading', { name: 'Import a deck' })).toBeVisible();
			const file = (name: string, id: string) => ({
				name,
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify(deckOf(id, `Bulk ${id}`, basicCards(2))), 'utf8')
			});
			await page
				.locator('input[type=file]')
				.setInputFiles([
					file('one.json', `a11y-bulk-1-${scheme}`),
					file('two.json', `a11y-bulk-2-${scheme}`),
					{ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{ "tessera": 1,') }
				]);
			await expect(page.getByRole('heading', { name: '3 files' })).toBeVisible();
			await scan(page, 'bulk queued');

			await page.getByRole('button', { name: 'Preview all' }).click();
			await expect(page.getByText('Problem', { exact: true })).toBeVisible();
			await scan(page, 'bulk previewed');

			await page.getByRole('button', { name: 'Import 2 decks' }).click();
			await expect(page.getByText('Imported', { exact: true }).first()).toBeVisible();
			await scan(page, 'bulk imported');
		});

		test('new deck: empty, with errors, and done', async ({ page }) => {
			await page.goto('/decks/new');
			await expect(page.getByRole('heading', { name: 'New deck', level: 1 })).toBeVisible();
			await scan(page, 'new deck empty');

			await page.getByLabel('Deck id').fill('Bad Id!');
			await page.getByRole('button', { name: 'Create deck' }).click();
			await expect(page.getByRole('alert')).toBeVisible();
			await scan(page, 'new deck errors');

			await page.getByLabel('Deck id').fill('');
			await page.getByLabel('Title').fill(`A11y new deck ${scheme}`);
			await page.getByRole('button', { name: 'Create deck' }).click();
			await expect(page.getByRole('heading', { name: 'Deck created' })).toBeVisible();
			await scan(page, 'new deck done');
		});

		test('trash: with decks, the delete panel, and the editor confirm', async ({
			page,
			request
		}) => {
			const id = `a11y-trash-${scheme}`;
			await importViaApi(request, deckOf(id, `A11y trash ${scheme}`, basicCards(2, 'q')));
			await page.goto(`/decks/${id}/edit`);
			await page.getByRole('button', { name: 'Move to Trash' }).click();
			await expect(page.getByText(`Move A11y trash ${scheme} to the Trash?`)).toBeVisible();
			await scan(page, 'editor move to trash confirm');

			await page.getByRole('button', { name: 'Move to Trash' }).last().click();
			await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
			await expect(page.getByText('is in the Trash')).toBeVisible();
			await scan(page, 'trash with a deck');

			await page
				.getByRole('button', { name: /for good/ })
				.first()
				.click();
			await expect(page.locator('.danger')).toBeVisible();
			await scan(page, 'trash delete panel');

			await page.getByLabel(/Type the deck title/).fill(`A11y trash ${scheme}`);
			await scan(page, 'trash delete panel typed');
		});

		test('start over: the panel, typed, and the result', async ({ page, request }) => {
			const id = `a11y-reset-${scheme}`;
			await importViaApi(request, deckOf(id, `A11y reset ${scheme}`, basicCards(2, 'z')));
			await page.goto(`/decks/${id}/edit`);
			await page.getByRole('button', { name: 'Start over…' }).click();
			await expect(page.getByLabel(/Type the deck title to confirm/)).toBeVisible();
			await scan(page, 'start over panel');

			await page.getByLabel(/Type the deck title to confirm/).fill(`A11y reset ${scheme}`);
			await scan(page, 'start over panel typed');

			await page.getByRole('button', { name: 'Start over', exact: true }).click();
			await expect(page.locator('.callout--ok').getByText('Started over.')).toBeVisible();
			await scan(page, 'start over result');
		});

		test('settings: as loaded, with problems, and saved', async ({ page, request }) => {
			await page.goto('/settings');
			await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
			await expect(page.getByLabel(/New cards per day/)).toHaveValue('20');
			await scan(page, 'settings loaded');

			await page.getByLabel(/New cards per day/).fill('-1');
			await page.getByLabel('Leech threshold').fill('1');
			await page.getByRole('button', { name: 'Save settings' }).click();
			await expect(page.locator('#newPerDay-problem')).toBeVisible();
			await scan(page, 'settings with problems');

			await page.getByRole('button', { name: 'Fill in the defaults' }).click();
			await page.getByLabel(/New cards per day/).fill('21');
			await page.getByRole('button', { name: 'Save settings' }).click();
			await expect(page.locator('.callout--ok')).toBeVisible();
			await scan(page, 'settings saved');
			await request.put('/api/settings', {
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify({ newPerDay: 20 })
			});
		});

		test('leeches: every card type, a card set aside, the report fallback, and empty', async ({
			page,
			request
		}) => {
			const id = `a11y-leech-${scheme}`;
			await importViaApi(
				request,
				deckOf(id, `A11y leech ${scheme}`, [
					{ id: 'b', type: 'basic', front: 'Basic **front**', back: 'Basic back', tags: ['t'] },
					{ id: 'c', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}' },
					{ id: 't', type: 'typed', front: 'Typed?', answer: 'yes' },
					{ id: 'm', type: 'choice', front: 'Pick', choices: ['One', 'Two'], correct: 1 }
				])
			);
			makeLeech(id, 'b', { lapses: 12 });
			makeLeech(id, 'c', { ordinal: 1, lapses: 10 });
			makeLeech(id, 't', { lapses: 9, wrongAnswers: ['no', 'maybe'] });
			makeLeech(id, 'm', { lapses: 8 });
			await page.goto('/leeches');
			await expect(page.getByRole('heading', { name: 'Leeches', level: 1 })).toBeVisible();
			await page
				.getByLabel('Show', { exact: true })
				.selectOption({ label: `A11y leech ${scheme}` });
			await expect(page.locator('.row')).toHaveCount(4);
			await scan(page, 'leeches list');

			await page.getByRole('button', { name: /Set card m aside/ }).click();
			await expect(page.locator('.badge')).toHaveText('Set aside');
			await scan(page, 'leeches with a card set aside');

			// The fallback text box, shown directly by refusing the clipboard.
			await page.evaluate(() => {
				Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
				document.execCommand = () => false;
			});
			await page.getByRole('button', { name: 'Copy the weak-spot report for Claude' }).click();
			await expect(page.getByLabel(/blocked copying/)).toBeVisible();
			await scan(page, 'leeches report fallback');

			await page
				.getByRole('button', { name: /Reset the leech flag/ })
				.first()
				.click();
			await expect(page.locator('.row')).toHaveCount(3);
		});

		test('leeches: empty', async ({ page, request }) => {
			const id = `a11y-leech-none-${scheme}`;
			await importViaApi(request, deckOf(id, `A11y leech none ${scheme}`, basicCards(1, 'n')));
			await page.goto('/leeches');
			await page
				.getByLabel('Show', { exact: true })
				.selectOption({ label: `A11y leech none ${scheme}` });
			await expect(page.getByText('No leeches.')).toBeVisible();
			await scan(page, 'leeches empty');
		});

		test('backups: the restore panel, and the restore waiting screen', async ({ page }) => {
			await page.goto('/backups');
			await page.getByRole('button', { name: 'Back up now' }).click();
			const name = (await page.locator('.callout--ok code').textContent())!;
			await page.getByRole('button', { name: `Restore ${name}` }).click();
			await expect(page.getByRole('table')).toBeVisible();
			await scan(page, 'restore panel');

			await page.getByLabel(/to confirm/).fill('restore');
			await scan(page, 'restore panel typed');

			await page.route(`**/api/backups/${name}/restore`, (route) =>
				route.fulfill({
					status: 202,
					contentType: 'application/json',
					body: JSON.stringify({ restoring: { name, safetyCopy: 'pre-restore-test.db' } })
				})
			);
			await page.route('**/healthz', (route) => route.abort('connectionrefused'));
			await page.getByRole('button', { name: 'Restore this backup' }).click();
			await expect(page.getByRole('heading', { name: 'Restoring…' })).toBeVisible();
			await scan(page, 'restore waiting');
		});

		test('backups: with a backup, a delete question, and empty', async ({ page, request }) => {
			await page.goto('/backups');
			await page.getByRole('button', { name: 'Back up now' }).click();
			const name = (await page.locator('.callout--ok code').textContent())!;
			await expect(page.locator('.row', { hasText: name })).toBeVisible();
			await scan(page, 'backups with a backup');

			await page.getByRole('button', { name: `Delete ${name}` }).click();
			await expect(page.getByText('Delete this backup?')).toBeVisible();
			await scan(page, 'backups delete question');

			const listed = (await (await request.get('/api/backups')).json()) as {
				backups: { name: string }[];
			};
			for (const backup of listed.backups) {
				await request.delete(`/api/backups/${encodeURIComponent(backup.name)}`, {
					headers: { 'content-type': 'application/json' }
				});
			}
			await page.goto('/backups');
			await expect(page.getByText('There are no backups yet.')).toBeVisible();
			await scan(page, 'backups empty');
		});

		test('trash: empty', async ({ page, request }) => {
			const trashed = (await (await request.get('/api/trash')).json()) as {
				decks: { id: string }[];
			};
			for (const deck of trashed.decks) {
				await request.post(`/api/decks/${deck.id}/restore`, {
					headers: { 'content-type': 'application/json' },
					data: '{}'
				});
			}
			await page.goto('/trash');
			await expect(page.getByText('The Trash is empty.')).toBeVisible();
			await scan(page, 'trash empty');
		});

		test('edit deck: closed, every card type open, with problems, and the review', async ({
			page,
			request
		}) => {
			const id = `a11y-edit-${scheme}`;
			await importViaApi(
				request,
				deckOf(id, `A11y edit ${scheme}`, [
					{ id: 'b', type: 'basic', front: 'Basic **front**', back: 'Basic back', hint: 'A hint' },
					{ id: 'c', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}', extra: 'More' },
					{ id: 't', type: 'typed', front: 'Typed?', answer: 'yes', accept: ['yep'] },
					{ id: 'm', type: 'choice', front: 'Pick', choices: ['One', 'Two'], correct: 0 }
				])
			);
			await page.goto(`/decks/${id}/edit`);
			await expect(page.getByRole('heading', { name: 'Edit deck', level: 1 })).toBeVisible();
			await expect(page.locator('.card')).toHaveCount(4);
			await scan(page, 'edit closed');

			for (let n = 1; n <= 4; n++) {
				await page.getByRole('button', { name: `Edit card ${n}` }).click();
			}
			await expect(page.locator('.card--open')).toHaveCount(4);
			await scan(page, 'edit every type open');

			// A new blank card, then a save attempt, shows every message.
			await page.getByRole('button', { name: 'Add a card' }).click();
			await page.getByRole('button', { name: 'Review changes' }).click();
			await expect(page.locator('.problem').first()).toBeVisible();
			await scan(page, 'edit with problems');

			await page.getByRole('button', { name: 'Remove card 5' }).click();
			await page.getByLabel('Title').fill(`A11y edit ${scheme} changed`);
			await page.getByRole('button', { name: 'Review changes' }).click();
			await expect(page.getByRole('heading', { name: /Updating deck/ })).toBeVisible();
			await scan(page, 'edit review');
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
