import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleExportDeck } from '#lib/server/api/export.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { decks } from '#lib/server/db/schema.ts';
import { upsertDeck } from '#lib/server/repos/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// GET /api/decks/:id/export (ADR-013). The handler is tested here without a server, the way the other API
// handlers are. The route file only passes the path and query to it.

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];

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

const SECRET = 'ZQXJ-EXPORT-SECRET-CARD-TEXT-4471';

const deckBody = (extra: Record<string, unknown>[] = []) => ({
	tessera: 1,
	deck: { id: 'ccna', title: 'CCNA', tags: ['ospf'] },
	cards: [
		{ id: 'a', type: 'basic', front: `Question ${SECRET}`, back: 'A a' },
		{ id: 'b', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}' },
		...extra
	]
});

async function importDeck(body: unknown): Promise<void> {
	const response = await handleImport(
		app,
		new Request('http://localhost/api/import', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		'req-import'
	);
	expect(response.status).toBe(200);
}

function exportOf(id: string, query = '') {
	return handleExportDeck(
		app,
		id,
		new URL(`http://localhost/api/decks/${id}/export${query}`),
		'req-1'
	);
}

describe('GET /api/decks/:id/export', () => {
	it('sends the deck as a JSON download by default', async () => {
		await importDeck(deckBody());
		const response = exportOf('ccna');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="ccna.json"');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = JSON.parse(await response.text());
		expect(body.deck).toEqual({ id: 'ccna', title: 'CCNA', tags: ['ospf'] });
		expect(body.cards.map((card: { id: string }) => card.id)).toEqual(['a', 'b']);
	});

	it('sends Markdown when asked, under either name for the format', async () => {
		await importDeck(deckBody());
		for (const format of ['md', 'markdown']) {
			const response = exportOf('ccna', `?format=${format}`);
			expect(response.status, format).toBe(200);
			expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
			expect(response.headers.get('content-disposition')).toBe('attachment; filename="ccna.md"');
			expect(await response.text()).toContain('## a');
		}
	});

	it('refuses a format it does not know, and names the ones it does', async () => {
		await importDeck(deckBody());
		for (const format of ['csv', 'JSON ', 'xml', '', 'apkg']) {
			const response = exportOf('ccna', `?format=${encodeURIComponent(format)}`);
			expect(response.status, format).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe('bad_request');
			expect(body.error.message).toMatch(/json/);
			expect(body.error.message).toMatch(/md/);
		}
	});

	it('answers 404 for an unknown deck, and the same for a deck in the Trash', async () => {
		await importDeck(deckBody());
		const missing = exportOf('nope');
		expect(missing.status).toBe(404);
		expect((await missing.json()).error.code).toBe('not_found');

		app.db.update(decks).set({ archived: true }).where(eq(decks.id, 'ccna')).run();
		const trashed = exportOf('ccna');
		expect(trashed.status).toBe(404);
		const trashedBody = await trashed.json();
		expect(trashedBody.error.message).toBe(
			(await exportOf('nope').json()).error.message.replace('nope', 'ccna')
		);
	});

	it('answers 409 and says why for a deck that has no cards', async () => {
		upsertDeck(
			app.db,
			{ id: 'empty', title: 'Empty', description: undefined, tags: undefined },
			'2026-10-12T12:00:00.000Z'
		);
		for (const query of ['', '?format=md']) {
			const response = exportOf('empty', query);
			expect(response.status, query).toBe(409);
			const body = await response.json();
			expect(body.error.code).toBe('conflict');
			expect(body.error.message).toMatch(/no cards/i);
		}
	});

	it('answers 404 without echoing anything for an id that cannot be a deck id', async () => {
		for (const bad of ['../etc/passwd', 'a b', 'UPPER', '', 'x'.repeat(200), 'a%2fb', '<script>']) {
			const response = exportOf(bad);
			expect(response.status, bad).toBe(404);
			const text = await response.text();
			expect(text, bad).not.toContain(bad === '' ? '\u0000' : bad);
			expect(JSON.parse(text).error.code).toBe('not_found');
		}
	});

	it('says what is wrong when a deck cannot be written as Markdown, and that JSON can', async () => {
		await importDeck({
			tessera: 1,
			deck: { id: 'odd', title: 'Odd' },
			cards: [{ id: 'x', type: 'basic', front: '  indented first line', back: 'A' }]
		});
		const response = exportOf('odd', '?format=md');
		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe('validation_failed');
		expect(body.error.message).toMatch(/Markdown/);
		expect(body.error.message).toMatch(/JSON/);
		// The same deck is fine as JSON.
		expect(exportOf('odd').status).toBe(200);
	});

	it('exports a deck that was changed by a second import, in the new order', async () => {
		await importDeck(deckBody());
		await importDeck({ ...deckBody(), cards: [...deckBody().cards].reverse() });
		const body = JSON.parse(await exportOf('ccna').text());
		expect(body.cards.map((card: { id: string }) => card.id)).toEqual(['b', 'a']);
	});

	it('closes the loop over HTTP: what it sends, import accepts as no change at all', async () => {
		await importDeck(deckBody());
		const text = await exportOf('ccna').text();
		const again = await handleImport(
			app,
			new Request('http://localhost/api/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: text
			}),
			'req-again'
		);
		expect(again.status).toBe(200);
		const result = (await again.json()).result;
		expect(result.changed).toBe(false);
		expect(result.counts).toMatchObject({ new: 0, updated: 0, unchanged: 2 });

		const markdown = await exportOf('ccna', '?format=md').text();
		const viaMarkdown = await handleImport(
			app,
			new Request('http://localhost/api/import', {
				method: 'POST',
				headers: { 'content-type': 'text/markdown' },
				body: markdown
			}),
			'req-md'
		);
		expect(viaMarkdown.status).toBe(200);
		expect((await viaMarkdown.json()).result.changed).toBe(false);
	});

	it('never writes card text to the log', async () => {
		await importDeck(deckBody());
		await exportOf('ccna').text();
		await exportOf('ccna', '?format=md').text();
		expect(logged.join('\n')).not.toContain(SECRET);
	});
});
