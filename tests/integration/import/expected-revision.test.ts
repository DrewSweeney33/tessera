import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { deckRevision } from '#lib/server/decks/index.ts';
import { listCardsForDeck, listImportHistory } from '#lib/server/repos/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// A save made from a copy of a deck that is out of date is refused, and nothing is written (ADR-013). The editor
// sends the revision it loaded. This is checked inside the import's own transaction, so another change cannot
// slip in between the check and the write.

let dir: TempDir;
let app: AppContext;

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T12:00:00.000Z'),
		log: createLogger({ level: 'error', write: () => undefined })
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const deck = (back = 'A a', extra: Record<string, unknown>[] = []) => ({
	tessera: 1,
	deck: { id: 'ccna', title: 'CCNA' },
	cards: [{ id: 'a', type: 'basic', front: 'Q a', back }, ...extra]
});

function post(body: unknown, query = '', type = 'application/json') {
	return handleImport(
		app,
		new Request(`http://localhost/api/import${query}`, {
			method: 'POST',
			headers: { 'content-type': type },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		'req-1'
	);
}

const revision = () => deckRevision(app.db, 'ccna')!;
const cardBack = () => listCardsForDeck(app.db, 'ccna')[0]!.content['back'];

describe('POST /api/import with expected_revision', () => {
	it('saves when the revision is the one the editor loaded', async () => {
		await post(deck());
		const loaded = revision();
		const response = await post(deck('A edited'), `?expected_revision=${loaded}`);
		expect(response.status).toBe(200);
		expect(cardBack()).toBe('A edited');
		expect(revision()).not.toBe(loaded);
	});

	it('refuses with 409 when the deck changed since, writes nothing, and says why', async () => {
		await post(deck());
		const loaded = revision();
		await post(deck('A changed somewhere else'));
		const historyBefore = listImportHistory(app.db).length;

		const response = await post(deck('A from the old copy'), `?expected_revision=${loaded}`);
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.error.code).toBe('conflict');
		expect(body.error.message).toMatch(/changed since you opened it/i);
		expect(body.error.details.errors[0]).toMatchObject({ path: 'deck', code: 'changed_elsewhere' });
		expect(cardBack()).toBe('A changed somewhere else');
		expect(listImportHistory(app.db)).toHaveLength(historyBefore);
	});

	it('also refuses a preview from an old copy, so the page learns before the owner presses Save', async () => {
		await post(deck());
		const loaded = revision();
		await post(deck('A changed'));
		const response = await post(deck('A old'), `?dry_run=true&expected_revision=${loaded}`);
		expect(response.status).toBe(409);
	});

	it('refuses a save from an old copy that adds a card, and the card is not added', async () => {
		await post(deck());
		const loaded = revision();
		await post(deck('A changed'));
		const response = await post(
			deck('A changed', [{ id: 'b', type: 'basic', front: 'Q b', back: 'A b' }]),
			`?expected_revision=${loaded}`
		);
		expect(response.status).toBe(409);
		expect(listCardsForDeck(app.db, 'ccna')).toHaveLength(1);
	});

	it('is not fooled by studying: a review in another tab does not make the editor stale', async () => {
		await post(deck());
		const loaded = revision();
		app.database.sqlite.prepare('update card_state set reps = reps + 1').run();
		const response = await post(
			deck('A edited while studying happened'),
			`?expected_revision=${loaded}`
		);
		expect(response.status).toBe(200);
	});

	it('works for a Markdown save as well', async () => {
		await post(deck());
		const loaded = revision();
		const markdown =
			'---\ntessera: 1\nid: ccna\ntitle: CCNA\n---\n\n## a\nQ: Q a\nA: A from markdown\n';
		const stale = await post(markdown, '?expected_revision=' + '0'.repeat(64), 'text/markdown');
		expect(stale.status).toBe(409);
		const fresh = await post(markdown, `?expected_revision=${loaded}`, 'text/markdown');
		expect(fresh.status).toBe(200);
		expect(cardBack()).toBe('A from markdown');
	});

	it('says the deck is gone, not just changed, when it no longer exists', async () => {
		const response = await post(deck(), `?expected_revision=${'a'.repeat(64)}`);
		expect(response.status).toBe(409);
		expect((await response.json()).error.message).toMatch(/no longer exists|does not exist/i);
		expect(deckRevision(app.db, 'ccna')).toBeUndefined();
	});

	it.each([
		'',
		'abc',
		'g'.repeat(64),
		'A'.repeat(64),
		`${'a'.repeat(63)}`,
		`${'a'.repeat(65)}`,
		'../etc'
	])('refuses the malformed revision %j with 400', async (value) => {
		await post(deck());
		const response = await post(deck('x'), `?expected_revision=${encodeURIComponent(value)}`);
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('bad_request');
	});

	it('leaves every other import exactly as it was when no revision is given', async () => {
		await post(deck());
		const response = await post(deck('A edited'));
		expect(response.status).toBe(200);
		expect(cardBack()).toBe('A edited');
	});
});
