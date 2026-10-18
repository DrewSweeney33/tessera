import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	NextResponse,
	PracticeUndoResponse,
	ReviewResponse,
	UndoResponse
} from '#lib/core/api-types.ts';
import { handlePracticeGrade, handlePracticeUndo } from '#lib/server/api/practice.ts';
import { handleStudyNext, handleStudyReview, handleStudyUndo } from '#lib/server/api/study.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { getCardByKey } from '#lib/server/repos/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { importForSetup } from '../../helpers/setup-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Undo over HTTP (ADR-019): what the two routes accept, answer, and refuse.

let dir: TempDir;
let app: AppContext;
let clock: FakeClock;
let counter = 0;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock('2026-10-12T15:00:00.000Z');
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		rng: () => 0.5,
		log: createLogger({ level: 'error', write: () => {} })
	});
	importForSetup(
		app.db,
		makeDeck([basic('a1'), basic('a2'), basic('a3')], { id: 'alpha', title: 'Alpha deck' }),
		app.clock
	);
	counter = 0;
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const post = (value: unknown, raw = false) =>
	new Request('http://localhost/api/x', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (value as string) : JSON.stringify(value)
	});
const pk = (key: string) => getCardByKey(app.db, 'alpha', key)!.pk;
const rows = () => app.database.sqlite.prepare('select * from review_log').all();
const stateOf = (key: string) =>
	app.database.sqlite
		.prepare('select * from card_state where card_pk = ? and ordinal = 0')
		.get(pk(key));

async function review(key: string, grade = 3) {
	const reviewId = `review-${String(++counter).padStart(8, '0')}`;
	const response = await handleStudyReview(
		app,
		post({
			reviewId,
			cardPk: pk(key),
			ordinal: 0,
			grade,
			servedAt: clock.now().toISOString(),
			deckId: 'alpha'
		}),
		'req'
	);
	expect(response.status).toBe(200);
	return { reviewId, body: (await response.json()) as ReviewResponse };
}

describe('POST /api/study/undo', () => {
	it('takes the answer back and returns the card to show again with the counts', async () => {
		const before = stateOf('a1');
		const { reviewId } = await review('a1');
		expect(stateOf('a1')).not.toEqual(before);

		const response = await handleStudyUndo(app, post({ reviewId, deckId: 'alpha' }), 'req');
		expect(response.status).toBe(200);
		const body = (await response.json()) as UndoResponse;
		expect(body.undone).toMatchObject({ reviewId, cardPk: pk('a1'), ordinal: 0, grade: 3 });
		expect(body.next.done).toBe(false);
		if (body.next.done) throw new Error('expected an item');
		expect(body.next.item).toMatchObject({ cardPk: pk('a1'), ordinal: 0, category: 'new' });
		expect(body.next.item.previews[3].label).toBeTruthy();
		expect(body.next.counts.new).toBe(3);
		expect(stateOf('a1')).toEqual(before);
		expect(rows()).toHaveLength(0);
	});

	it('serves the same card again even when the queue would pick another', async () => {
		const { reviewId } = await review('a2');
		const response = await handleStudyUndo(app, post({ reviewId }), 'req');
		const body = (await response.json()) as UndoResponse;
		if (body.next.done) throw new Error('expected an item');
		expect(body.next.item.cardPk).toBe(pk('a2'));
		const next = (await (
			await handleStudyNext(app, new URL('http://localhost/api/study/next'), 'req')
		).json()) as NextResponse;
		expect(next.done).toBe(false);
	});

	it('answers 409 for an answer that is not the newest, and changes nothing', async () => {
		const first = await review('a1');
		clock.advance(60_000);
		await review('a2');
		const response = await handleStudyUndo(app, post({ reviewId: first.reviewId }), 'req');
		expect(response.status).toBe(409);
		const body = (await response.json()) as { error: { code: string; details: unknown } };
		expect(body.error.code).toBe('conflict');
		expect(body.error.details).toEqual({ reason: 'not_latest' });
		expect(rows()).toHaveLength(2);
	});

	it('answers 404 for an unknown id and for an answer that was already undone', async () => {
		const unknown = await handleStudyUndo(app, post({ reviewId: 'review-99999999' }), 'req');
		expect(unknown.status).toBe(404);
		const { reviewId } = await review('a1');
		expect((await handleStudyUndo(app, post({ reviewId }), 'req')).status).toBe(200);
		expect((await handleStudyUndo(app, post({ reviewId }), 'req')).status).toBe(404);
	});

	it('rejects a bad body with a 422 and names the field', async () => {
		for (const bad of [
			{},
			{ reviewId: 'short' },
			{ reviewId: 'review-00000001', extra: 1 },
			{ reviewId: 'review 0000001!' },
			{ reviewId: 'review-00000001', deckId: 5 },
			{ reviewId: 'review-00000001', folderId: -3 }
		]) {
			const response = await handleStudyUndo(app, post(bad), 'req');
			expect(response.status, JSON.stringify(bad)).toBe(422);
		}
		expect((await handleStudyUndo(app, post('{not json', true), 'req')).status).toBe(400);
	});

	it('refuses a deck that does not exist and both a deck and a folder', async () => {
		const { reviewId } = await review('a1');
		expect((await handleStudyUndo(app, post({ reviewId, deckId: 'nope' }), 'req')).status).toBe(
			404
		);
		expect(
			(await handleStudyUndo(app, post({ reviewId, deckId: 'alpha', folderId: 1 }), 'req')).status
		).toBe(400);
		// Nothing was undone by the refused requests.
		expect(rows()).toHaveLength(1);
	});
});

describe('POST /api/practice/undo', () => {
	async function practise(key: string, right: boolean) {
		const reviewId = `practice-${String(++counter).padStart(8, '0')}`;
		const response = await handlePracticeGrade(
			app,
			post({ reviewId, cardPk: pk(key), ordinal: 0, right }),
			'req'
		);
		expect(response.status).toBe(200);
		return reviewId;
	}

	it('deletes the newest practice row and nothing else, and leaves every schedule alone', async () => {
		const study = await review('a1');
		clock.advance(60_000);
		const stateBefore = stateOf('a1');
		const id = await practise('a1', false);
		expect(rows()).toHaveLength(2);

		const response = await handlePracticeUndo(app, post({ reviewId: id }), 'req');
		expect(response.status).toBe(200);
		const body = (await response.json()) as PracticeUndoResponse;
		expect(body.undone).toEqual({ reviewId: id, cardPk: pk('a1'), ordinal: 0, right: false });
		expect(rows()).toHaveLength(1);
		expect((rows()[0] as { id: string }).id).toBe(study.reviewId);
		expect(stateOf('a1')).toEqual(stateBefore);
	});

	it('refuses a practice answer that is not the newest, an unknown id, and a study answer', async () => {
		const study = await review('a1');
		const first = await practise('a2', true);
		clock.advance(60_000);
		await practise('a3', true);

		const old = await handlePracticeUndo(app, post({ reviewId: first }), 'req');
		expect(old.status).toBe(409);
		expect(
			(await handlePracticeUndo(app, post({ reviewId: 'practice-99999999' }), 'req')).status
		).toBe(404);
		expect((await handlePracticeUndo(app, post({ reviewId: study.reviewId }), 'req')).status).toBe(
			404
		);
		expect(rows()).toHaveLength(3);
	});

	it('rejects a bad body', async () => {
		for (const bad of [{}, { reviewId: 'x' }, { reviewId: 'practice-00000001', right: true }]) {
			expect((await handlePracticeUndo(app, post(bad), 'req')).status).toBe(422);
		}
	});

	it('is not the route for study answers: a study undo cannot remove a practice row', async () => {
		const id = await practise('a1', true);
		expect((await handleStudyUndo(app, post({ reviewId: id }), 'req')).status).toBe(404);
		expect(rows()).toHaveLength(1);
	});
});
