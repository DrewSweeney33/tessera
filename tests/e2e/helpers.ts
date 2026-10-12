import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TestCard {
	id: string;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	[field: string]: unknown;
}

export function deckOf(id: string, title: string, cards: TestCard[]) {
	return { tessera: 1, deck: { id, title }, cards };
}

// Imports a deck straight through the API, bypassing the UI, to set up a scenario quickly.
export async function importViaApi(request: APIRequestContext, deck: unknown): Promise<void> {
	const response = await request.post('/api/import', {
		headers: { 'content-type': 'application/json' },
		data: JSON.stringify(deck)
	});
	expect(response.ok(), await response.text()).toBe(true);
}

export function basicCards(count: number, prefix = 'card'): TestCard[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `${prefix}-${i + 1}`,
		type: 'basic' as const,
		front: `Question ${i + 1}`,
		back: `Answer ${i + 1}`
	}));
}

// True if the page scrolls sideways, which means something overflows the viewport.
export async function scrollsHorizontally(page: Page): Promise<boolean> {
	return page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
}

// Makes a card a leech without studying it eight times: sets the flag and the lapse count in the test server's own
// database, and adds the wrong typed answers to its review log. The server and this test share one SQLite file, which
// is safe because the database waits for the write lock.
export function makeLeech(
	deckId: string,
	key: string,
	options: { lapses?: number; ordinal?: number; wrongAnswers?: string[] } = {}
): void {
	const db = new Database(join('.e2e-data', 'tessera.db'));
	try {
		db.pragma('busy_timeout = 5000');
		const card = db
			.prepare('select pk from cards where deck_id = ? and key = ?')
			.get(deckId, key) as { pk: number } | undefined;
		if (!card) throw new Error(`no card ${deckId}/${key}`);
		const ordinal = options.ordinal ?? 0;
		const lapses = options.lapses ?? 9;
		db.prepare(
			"update card_state set leech = 1, lapses = ?, reps = ?, phase = 2, last_review = '2026-10-11T09:00:00.000Z' where card_pk = ? and ordinal = ?"
		).run(lapses, lapses + 4, card.pk, ordinal);
		const insert = db.prepare(
			`insert into review_log (id, card_pk, ordinal, mode, grade, pre_due, pre_stability, pre_difficulty, pre_elapsed_days,
				pre_scheduled_days, pre_learning_steps, pre_reps, pre_lapses, pre_phase, pre_last_review, result, scheduled_days,
				duration_ms, typed_answer, reviewed_at)
			 values (?, ?, ?, 'review', 1, '2026-10-01T00:00:00.000Z', 1, 5, 1, 1, 0, 1, 0, 2, null, null, null, 1000, ?, ?)`
		);
		(options.wrongAnswers ?? []).forEach((answer, i) => {
			insert.run(
				`e2e-${deckId}-${key}-${ordinal}-${i}-${Date.now()}`,
				card.pk,
				ordinal,
				answer,
				`2026-10-0${i + 1}T10:00:00.000Z`
			);
		});
	} finally {
		db.close();
	}
}
