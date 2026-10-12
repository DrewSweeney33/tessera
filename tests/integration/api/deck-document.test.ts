import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleCreateDeck } from '#lib/server/api/decks.ts';
import { handleGetDeck } from '#lib/server/api/deck.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { deckRevision } from '#lib/server/decks/index.ts';
import { decks } from '#lib/server/db/schema.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// GET /api/decks/:id gives an editor everything it needs in one request: the deck as a deck document, the deck as
// the home page lists it, and the revision that a later save must send back (ADR-013).

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];
const SECRET = 'ZQXJ-DOCUMENT-SECRET-6624';

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T12:00:00.000Z'),
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const body = (cards: Record<string, unknown>[]) => ({
	tessera: 1,
	deck: { id: 'ccna', title: 'CCNA', description: 'Notes', tags: ['net'] },
	cards
});

const cards = () => [
	{ id: 'a', type: 'basic', front: `Question ${SECRET}`, back: 'A a', hint: 'h' },
	{ id: 'b', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}', tags: ['ospf'] },
	{ id: 'c', type: 'typed', front: 'Cmd?', answer: 'show ip route', accept: ['sh ip route'] },
	{ id: 'd', type: 'choice', front: 'Pick', choices: ['x', 'y', 'z'], correct: 1 }
];

async function importDeck(deck: unknown, query = ''): Promise<Response> {
	return handleImport(
		app,
		new Request(`http://localhost/api/import${query}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(deck)
		}),
		'req-import'
	);
}

const get = (id: string) => handleGetDeck(app, id, 'req-1');

describe('GET /api/decks/:id', () => {
	it('answers with the deck document, the deck summary, and the revision', async () => {
		await importDeck(body(cards()));
		const response = get('ccna');
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.document.tessera).toBe(1);
		expect(result.document.deck).toEqual({
			id: 'ccna',
			title: 'CCNA',
			description: 'Notes',
			tags: ['net']
		});
		expect(result.document.cards.map((card: { id: string }) => card.id)).toEqual([
			'a',
			'b',
			'c',
			'd'
		]);
		expect(result.document.cards[0]).toMatchObject({ type: 'basic', hint: 'h' });
		expect(result.document.cards[1]).toMatchObject({ type: 'cloze', tags: ['ospf'] });
		expect(result.document.cards[2]).toMatchObject({ accept: ['sh ip route'] });
		expect(result.document.cards[3]).toMatchObject({ correct: 1, choices: ['x', 'y', 'z'] });
		expect(result.deck).toMatchObject({ id: 'ccna', title: 'CCNA', cardCount: 4 });
		expect(result.revision).toBe(deckRevision(app.db, 'ccna'));
		expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
	});

	it('works for a deck with no cards, which a hand-made deck is until it gets some', async () => {
		await handleCreateDeck(
			app,
			new Request('http://localhost/api/decks', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: 'empty', title: 'Empty' })
			}),
			'req-create'
		);
		const response = get('empty');
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.document.cards).toEqual([]);
		expect(result.deck.cardCount).toBe(0);
		expect(result.revision).toBe(deckRevision(app.db, 'empty'));
	});

	it('leaves out cards that were removed, as export does', async () => {
		await importDeck(body(cards()));
		await importDeck(body(cards().slice(0, 2)), '?archive_missing=true');
		const result = await get('ccna').json();
		expect(result.document.cards.map((card: { id: string }) => card.id)).toEqual(['a', 'b']);
		expect(result.deck.cardCount).toBe(2);
	});

	it('answers 404, the same for all of them, for an unknown deck, one in the Trash, or a bad id', async () => {
		await importDeck(body(cards()));
		app.db.update(decks).set({ archived: true }).where(eq(decks.id, 'ccna')).run();
		const missing = await get('nope').json();
		const trashed = await get('ccna').json();
		expect(trashed.error.code).toBe('not_found');
		expect(trashed.error.message).toBe(missing.error.message.replace('nope', 'ccna'));
		for (const bad of ['../x', 'A B', '', 'x'.repeat(80), '<script>']) {
			const response = get(bad);
			expect(response.status, bad).toBe(404);
			const text = await response.text();
			expect(text, bad).not.toContain(bad === '' ? '\u0000' : bad);
		}
	});

	it('gives a revision that a save can use, and that a later change makes stale', async () => {
		await importDeck(body(cards()));
		const loaded = (await get('ccna').json()).revision;

		const edited = body(cards());
		edited.cards[0] = { ...edited.cards[0]!, back: 'A edited' };
		const saved = await importDeck(edited, `?expected_revision=${loaded}`);
		expect(saved.status).toBe(200);

		const again = body(cards());
		again.cards[0] = { ...again.cards[0]!, back: 'A from the old copy' };
		const stale = await importDeck(again, `?expected_revision=${loaded}`);
		expect(stale.status).toBe(409);
		const fresh = (await get('ccna').json()).revision;
		expect(fresh).not.toBe(loaded);
	});

	it('hands back what export would, card for card', async () => {
		await importDeck(body(cards()));
		const { document } = await get('ccna').json();
		const { handleExportDeck } = await import('#lib/server/api/export.ts');
		const exported = JSON.parse(
			await handleExportDeck(
				app,
				'ccna',
				new URL('http://localhost/api/decks/ccna/export'),
				'r'
			).text()
		);
		expect(document).toEqual(exported);
	});

	it('never writes card text to the log', async () => {
		await importDeck(body(cards()));
		await get('ccna').text();
		expect(logged.join('\n')).not.toContain(SECRET);
	});
});
