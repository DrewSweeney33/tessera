import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { deckOf, importViaApi } from './helpers.ts';

// Practice by tag (ADR-020): a tag is the third practice scope, reached from the weakest-tags lists on Statistics and
// Leeches. Every deck and tag has its own name because the specs share one server.

const ROUTING = 'e2e-routing';
const SWITCHING = 'e2e-switching';

interface DeckRow {
	id: string;
	counts: { new: number; learning: number; review: number };
}

async function deckCounts(request: APIRequestContext, id: string) {
	const response = await request.get('/api/decks');
	return ((await response.json()) as { decks: DeckRow[] }).decks.find((deck) => deck.id === id)!
		.counts;
}

// Gives cards a history in the test server's own database so the tag lists have something to rank: `count` recalled
// reviews of already learned cards each, a few minutes ago. The server and this test share one SQLite file, which is
// safe because the database waits for the write lock.
function addReviews(deckId: string, keys: string[], count: number) {
	const db = new Database(join('.e2e-data', 'tessera.db'));
	try {
		db.pragma('busy_timeout = 5000');
		const insert = db.prepare(
			`insert into review_log (id, card_pk, ordinal, mode, grade, pre_due, pre_stability, pre_difficulty, pre_elapsed_days,
				pre_scheduled_days, pre_learning_steps, pre_reps, pre_lapses, pre_phase, pre_last_review, result, scheduled_days,
				duration_ms, typed_answer, reviewed_at)
			 values (?, ?, 0, 'review', ?, '2026-10-01T00:00:00.000Z', 1, 5, 1, 1, 0, 1, 0, 2, null, null, null, 1000, null, ?)`
		);
		for (const key of keys) {
			const card = db
				.prepare('select pk from cards where deck_id = ? and key = ?')
				.get(deckId, key) as { pk: number };
			for (let i = 0; i < count; i++) {
				insert.run(
					`e2e-tag-${deckId}-${key}-${i}-${Date.now()}`,
					card.pk,
					i % 5 === 0 ? 1 : 3,
					new Date(Date.now() - (i + 1) * 60_000).toISOString()
				);
			}
		}
	} finally {
		db.close();
	}
}

async function seed(request: APIRequestContext, id: string) {
	await importViaApi(
		request,
		deckOf(id, `Tags ${id}`, [
			{ id: 'r1', type: 'basic', front: 'Route one', back: 'A', tags: [ROUTING] },
			{ id: 'r2', type: 'basic', front: 'Route two', back: 'A', tags: [ROUTING] },
			{ id: 's1', type: 'basic', front: 'Switch one', back: 'A', tags: [SWITCHING] },
			{ id: 'x1', type: 'basic', front: 'Untagged one', back: 'A' }
		])
	);
	addReviews(id, ['r1', 'r2'], 6);
	addReviews(id, ['s1'], 12);
}

test.describe('practice by tag', () => {
	test('is reached from Statistics, practices only that tag, and leaves the schedule alone', async ({
		page,
		request
	}) => {
		await seed(request, 'e2e-tag-1');
		const before = await deckCounts(request, 'e2e-tag-1');

		await page.goto('/stats');
		const link = page.getByRole('link', { name: `Practice the tag ${ROUTING}` });
		await expect(link).toBeVisible();
		await link.click();
		await expect(page).toHaveURL(new RegExp(`/practice\\?tag=${ROUTING}$`));
		await expect(page.getByRole('heading', { name: 'Practice again', level: 1 })).toBeVisible();
		await expect(page.getByText(`Tag: ${ROUTING}`).first()).toBeVisible();

		await page.getByRole('button', { name: 'Start practice' }).click();
		const seen = new Set<string>();
		const complete = page.getByRole('heading', { name: 'Practice complete' });
		const showAnswer = page.getByRole('button', { name: /Show answer/ });
		for (let i = 0; i < 20; i++) {
			// Waits for either the next card or the end of the session: after the last answer there is no next card.
			await expect(showAnswer.or(complete)).toBeVisible();
			if (await complete.isVisible()) break;
			seen.add((await page.locator('.card__front').first().innerText()).trim());
			await showAnswer.click();
			await page.getByRole('button', { name: /Got it/ }).click();
		}
		await expect(complete).toBeVisible();
		// Only cards that carry the tag were shown, and every one of them.
		expect([...seen].every((text) => text.startsWith('Route'))).toBe(true);
		expect(seen.has('Route one') && seen.has('Route two')).toBe(true);
		// Practice answers change no schedule.
		expect(await deckCounts(request, 'e2e-tag-1')).toEqual(before);
	});

	test('is reached from the weakest tags on the Leeches page', async ({ page, request }) => {
		await seed(request, 'e2e-tag-2');
		await page.goto('/leeches');
		const link = page.getByRole('link', { name: `Practice the tag ${SWITCHING}` });
		await expect(link).toBeVisible();
		expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
		await link.click();
		await expect(page).toHaveURL(new RegExp(`/practice\\?tag=${SWITCHING}$`));
		await expect(page.getByText(`Tag: ${SWITCHING}`).first()).toBeVisible();
	});

	test('says there is nothing to practice for a tag no card has, and for a hostile one', async ({
		page
	}) => {
		for (const tag of ['no-card-has-this', "x' or '1'='1", '<script>alert(1)</script>']) {
			await page.goto(`/practice?tag=${encodeURIComponent(tag)}`);
			await expect(page.getByRole('heading', { name: 'Practice again', level: 1 })).toBeVisible();
			await expect(page.getByText('There is nothing to practice here yet.')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Start practice' })).toHaveCount(0);
		}
	});

	test('wants exactly one scope in the address', async ({ page }) => {
		for (const query of [
			'?tag=a&deck=b',
			'?tag=a&folder=1',
			'?tag=a%2Cb',
			`?tag=${'x'.repeat(41)}`
		]) {
			await page.goto(`/practice${query}`);
			await expect(
				page
					.getByRole('status')
					.filter({ hasText: 'Choose a deck, a folder, or a tag to practice' })
			).toBeVisible();
		}
	});

	test('keeps a tag session across a reload and offers to resume it', async ({ page, request }) => {
		await seed(request, 'e2e-tag-3');
		await page.goto(`/practice?tag=${SWITCHING}`);
		await page.getByRole('button', { name: 'Start practice' }).click();
		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.getByRole('button', { name: /Got it/ }).click();
		await page.reload();
		await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
	});

	test('the Practice link on Statistics is a 44 px touch target at 320px', async ({
		page,
		request
	}) => {
		await seed(request, 'e2e-tag-4');
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/stats');
		const link = page.getByRole('link', { name: `Practice the tag ${ROUTING}` });
		await expect(link).toBeVisible();
		expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth
			)
		).toBe(false);
	});
});
