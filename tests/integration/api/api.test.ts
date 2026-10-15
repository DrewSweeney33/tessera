import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleHealth } from '#lib/server/api/health.ts';
import { handleSchema } from '#lib/server/api/schema.ts';
import { handleListDecks } from '#lib/server/api/decks.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { cards, cardState } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { listImportHistory } from '#lib/server/repos/index.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;
let app: AppContext;
const logged: Record<string, unknown>[] = [];

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	logged.length = 0;
	app = createApp({
		config: config.value,
		clock: fakeClock(),
		log: createLogger({
			level: 'info',
			write: (line) => logged.push(JSON.parse(line) as Record<string, unknown>)
		})
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const deck = (cards: Record<string, unknown>[], meta: Record<string, unknown> = {}) => ({
	tessera: 1,
	deck: { id: 'ccna', title: 'CCNA', ...meta },
	cards
});

const twoCards = () => [
	{ id: 'a', type: 'basic', front: 'Q a', back: 'A a' },
	{ id: 'b', type: 'cloze', text: 'The {{c1::DR}} and {{c2::BDR}}' }
];

function post(body: unknown, query = '', headers: Record<string, string> = {}): Request {
	return new Request(`http://localhost/api/import${query}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

async function importDeck(body: unknown, query = '', headers: Record<string, string> = {}) {
	const response = await handleImport(app, post(body, query, headers), 'req-1');
	return { response, body: await response.json() };
}

function deckCount(): number {
	return (app.database.sqlite.prepare('select count(*) as n from decks').get() as { n: number }).n;
}

describe('GET /healthz', () => {
	it('reports ok with the version when the database responds', async () => {
		const response = handleHealth(app);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = await response.json();
		expect(body).toMatchObject({ ok: true, dbOk: true });
		expect(typeof body.version).toBe('string');
	});

	it('reports 503 when the database does not respond', async () => {
		app.database.close();
		const response = handleHealth(app);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, dbOk: false });
	});
});

describe('GET /api/schema', () => {
	it('serves the JSON Schema as application/schema+json', async () => {
		const response = handleSchema();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/schema+json');
		const schema = await response.json();
		expect(schema.$schema).toContain('2020-12');
		expect(schema.additionalProperties).toBe(false);
	});
});

describe('POST /api/import: committing', () => {
	it('imports a deck and reports counts', async () => {
		const { response, body } = await importDeck(deck(twoCards()));
		expect(response.status).toBe(200);
		expect(body.dryRun).toBe(false);
		expect(body.result).toMatchObject({
			deckId: 'ccna',
			changed: true,
			counts: { new: 2, updated: 0, unchanged: 0 }
		});
		expect(typeof body.result.importHistoryId).toBe('number');
		expect(deckCount()).toBe(1);
	});

	it('accepts a deck wrapped in a code fence, as pasted from a Claude reply', async () => {
		const { response } = await importDeck('```json\n' + JSON.stringify(deck(twoCards())) + '\n```');
		expect(response.status).toBe(200);
	});

	it('is idempotent: importing the same deck again changes nothing', async () => {
		await importDeck(deck(twoCards()));
		const again = await importDeck(deck(twoCards()));
		expect(again.body.result).toMatchObject({ changed: false, counts: { unchanged: 2, new: 0 } });
		expect(listImportHistory(app.db)).toHaveLength(1);
	});

	it('records the filename and format in the import history', async () => {
		await importDeck(deck(twoCards()), '?filename=ccna-ospf.json');
		expect(listImportHistory(app.db)[0]).toMatchObject({
			filename: 'ccna-ospf.json',
			format: 'json'
		});
	});

	it('archives missing cards only when asked', async () => {
		await importDeck(deck(twoCards()));
		const only = deck([twoCards()[0]!]);
		const kept = await importDeck(only);
		expect(kept.body.result.counts).toMatchObject({ absent: 1, archivedMissing: 0 });
		const archived = await importDeck(only, '?archive_missing=true');
		expect(archived.body.result.counts).toMatchObject({ archivedMissing: 1 });
	});

	it('logs the import without any card content', async () => {
		await importDeck(
			deck([{ id: 'a', type: 'basic', front: 'SECRET FRONT', back: 'SECRET BACK' }])
		);
		const line = logged.find((l) => l['msg'] === 'import committed')!;
		expect(line).toMatchObject({ deckId: 'ccna', new: 1 });
		expect(JSON.stringify(logged)).not.toContain('SECRET');
	});
});

describe('POST /api/import: dry run', () => {
	it('previews without writing anything', async () => {
		const { response, body } = await importDeck(deck(twoCards()), '?dry_run=true');
		expect(response.status).toBe(200);
		expect(body.dryRun).toBe(true);
		expect(body.plan.counts).toMatchObject({ new: 2, unchanged: 0 });
		expect(body.plan.deck).toMatchObject({ id: 'ccna', action: 'created', changed: true });
		expect(body.plan.cards.map((c: { key: string }) => c.key)).toEqual(['a', 'b']);
		expect(deckCount()).toBe(0);
		expect(listImportHistory(app.db)).toHaveLength(0);
	});

	it('lists only changed cards and names the changed fields', async () => {
		await importDeck(deck(twoCards()));
		const revised = twoCards();
		revised[0] = { id: 'a', type: 'basic', front: 'Q a', back: 'A a, rewritten' };
		const { body } = await importDeck(deck(revised), '?dry_run=1');
		expect(body.plan.counts).toMatchObject({ updated: 1, unchanged: 1 });
		expect(body.plan.cards).toEqual([
			{
				key: 'a',
				index: 0,
				action: 'updated',
				changedFields: ['back'],
				changes: [{ field: 'back', before: 'A a', after: 'A a, rewritten', cut: false }],
				progressLost: 0,
				restored: false,
				generatedKey: false
			}
		]);
	});

	it('previews what archive_missing would do', async () => {
		await importDeck(deck(twoCards()));
		const { body } = await importDeck(deck([twoCards()[0]!]), '?dry_run=true&archive_missing=true');
		expect(body.plan).toMatchObject({
			archiveMissing: true,
			counts: { absent: 1, archivedMissing: 1 },
			absent: [{ key: 'b', archived: false }]
		});
	});

	it('includes the generated-id warning', async () => {
		const { body } = await importDeck(
			deck([{ type: 'basic', front: 'No id', back: 'A' }]),
			'?dry_run=true'
		);
		expect(body.plan.warnings[0]).toMatchObject({ code: 'generated_id' });
	});
});

describe('POST /api/import: problems', () => {
	it('returns 422 with path-level errors for an invalid deck', async () => {
		const bad = deck([{ type: 'basic', front: 'Only a front' }, { type: 'flip' }]);
		const { response, body } = await importDeck(bad);
		expect(response.status).toBe(422);
		expect(response.headers.get('x-request-id')).toBe('req-1');
		expect(body.error.code).toBe('validation_failed');
		expect(body.error.details.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'cards[0].back', code: 'required' }),
				expect.objectContaining({ path: 'cards[1].type', code: 'invalid_value' })
			])
		);
		expect(deckCount()).toBe(0);
	});

	it('refuses a cloze card with an unclosed blank, says where, and writes nothing', async () => {
		const { response, body } = await importDeck(
			deck([
				{ id: 'good', type: 'cloze', text: 'The {{c1::DR}} wins.' },
				{ id: 'bad', type: 'cloze', text: 'First line\nThe {{c1::BDR never closed' }
			])
		);
		expect(response.status).toBe(422);
		expect(body.error.details.errors).toHaveLength(1);
		expect(body.error.details.errors[0]).toMatchObject({
			path: 'cards[1].text',
			code: 'unclosed_cloze'
		});
		expect(body.error.details.errors[0].message).toContain('line 2, column 5');
		expect(deckCount()).toBe(0);
	});

	it('returns 422 with a located syntax error for broken JSON', async () => {
		const { response, body } = await importDeck('{\n  "tessera": 1,\n}');
		expect(response.status).toBe(422);
		expect(body.error.details.errors[0]).toMatchObject({ code: 'invalid_json', line: 3 });
	});

	it('reports duplicate keys from cards without ids', async () => {
		const { response, body } = await importDeck(
			deck([
				{ type: 'basic', front: 'Same', back: '1' },
				{ type: 'basic', front: 'Same', back: '2' }
			])
		);
		expect(response.status).toBe(422);
		expect(body.error.details.errors[0]).toMatchObject({ path: 'cards[1]', code: 'duplicate_id' });
	});

	it('rejects bad query flags with 400', async () => {
		const { response, body } = await importDeck(deck(twoCards()), '?dry_run=maybe');
		expect(response.status).toBe(400);
		expect(body.error.message).toContain('dry_run');
		expect((await importDeck(deck(twoCards()), '?archive_missing=yes')).response.status).toBe(400);
	});

	it('refuses a body whose declared length is over the limit', async () => {
		const { response, body } = await importDeck(deck(twoCards()), '', {
			'content-length': String(5 * 1024 * 1024 + 1)
		});
		expect(response.status).toBe(413);
		expect(body.error.code).toBe('payload_too_large');
	});

	it('refuses an over-limit body even when no length was declared', async () => {
		const { response, body } = await importDeck(' '.repeat(5 * 1024 * 1024 + 1));
		expect(response.status).toBe(413);
		expect(body.error.code).toBe('payload_too_large');
	});

	it.each([
		'text/plain',
		'application/x-www-form-urlencoded',
		'',
		'constructor',
		'__proto__',
		'toString'
	])(
		'refuses the content type %j with 415 and a message naming the two it accepts',
		async (type) => {
			const response = await handleImport(
				app,
				new Request('http://localhost/api/import', {
					method: 'POST',
					headers: type === '' ? {} : { 'content-type': type },
					body: JSON.stringify(deck(twoCards()))
				}),
				'req-1'
			);
			expect(response.status).toBe(415);
			const body = await response.json();
			expect(body.error.details.accepted).toEqual(['application/json', 'text/markdown']);
			expect(deckCount()).toBe(0);
		}
	);
});

const MARKDOWN_DECK = `---
tessera: 1
id: ccna
title: CCNA
---

## a
Q: Q a
A: A a

## b
Cloze: The {{c1::DR}} and {{c2::BDR}}
`;

function postMarkdown(body: string, query = '', type = 'text/markdown'): Request {
	return new Request(`http://localhost/api/import${query}`, {
		method: 'POST',
		headers: { 'content-type': type },
		body
	});
}

async function importMarkdown(body: string, query = '', type = 'text/markdown') {
	const response = await handleImport(app, postMarkdown(body, query, type), 'req-1');
	return { response, body: await response.json() };
}

describe('POST /api/import: Markdown', () => {
	it('imports a Markdown deck and reports counts', async () => {
		const { response, body } = await importMarkdown(MARKDOWN_DECK);
		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			dryRun: false,
			result: { deckId: 'ccna', changed: true, counts: { new: 2, unchanged: 0 } }
		});
		expect(deckCount()).toBe(1);
	});

	it('records the format and filename in the import history', async () => {
		await importMarkdown(MARKDOWN_DECK, '?filename=ccna.md');
		expect(listImportHistory(app.db)[0]).toMatchObject({ filename: 'ccna.md', format: 'markdown' });
	});

	it('accepts a charset on the content type', async () => {
		const { response } = await importMarkdown(MARKDOWN_DECK, '', 'text/markdown; charset=utf-8');
		expect(response.status).toBe(200);
		const upper = await importMarkdown(MARKDOWN_DECK, '', 'TEXT/Markdown');
		expect(upper.response.status).toBe(200);
	});

	it('accepts a byte order mark, Windows line endings, and a wrapping code fence', async () => {
		const bom = String.fromCharCode(0xfeff);
		const wrapped = `${bom}\`\`\`markdown\n${MARKDOWN_DECK}\`\`\`\n`.replaceAll('\n', '\r\n');
		const { response, body } = await importMarkdown(wrapped);
		expect(response.status).toBe(200);
		expect(body.result.counts.new).toBe(2);
	});

	it('gives the same plan for the same deck as JSON and as Markdown', async () => {
		const asJson = await importDeck(deck(twoCards()), '?dry_run=true');
		const asMarkdown = await importMarkdown(MARKDOWN_DECK, '?dry_run=true');
		expect(asMarkdown.body).toEqual(asJson.body);
		expect(deckCount()).toBe(0);
	});

	it('treats the two formats as one deck: each import is unchanged after the other', async () => {
		await importDeck(deck(twoCards()));
		const again = await importMarkdown(MARKDOWN_DECK);
		expect(again.body.result).toMatchObject({ changed: false, counts: { unchanged: 2, new: 0 } });
		expect(listImportHistory(app.db)).toHaveLength(1);

		const reverse = await importDeck(deck(twoCards()));
		expect(reverse.body.result).toMatchObject({ changed: false, counts: { unchanged: 2 } });
	});

	it('reports an edited card as updated, with the field that changed', async () => {
		await importMarkdown(MARKDOWN_DECK);
		const edited = MARKDOWN_DECK.replace('A: A a', 'A: A a, revised');
		const { body } = await importMarkdown(edited, '?dry_run=true');
		expect(body.plan.counts).toMatchObject({ updated: 1, unchanged: 1, new: 0 });
		expect(body.plan.cards).toEqual([
			expect.objectContaining({ key: 'a', action: 'updated', changedFields: ['back'] })
		]);
	});

	it('writes nothing on a dry run', async () => {
		const { body } = await importMarkdown(MARKDOWN_DECK, '?dry_run=true');
		expect(body).toMatchObject({ dryRun: true, plan: { counts: { new: 2 } } });
		expect(deckCount()).toBe(0);
		expect(listImportHistory(app.db)).toHaveLength(0);
	});

	it('honours archive_missing for Markdown too', async () => {
		await importMarkdown(MARKDOWN_DECK);
		const onlyA = MARKDOWN_DECK.slice(0, MARKDOWN_DECK.indexOf('## b'));
		const { body } = await importMarkdown(onlyA, '?archive_missing=true');
		expect(body.result.counts).toMatchObject({ archivedMissing: 1 });
	});

	it('returns 422 with line numbers for a bad Markdown deck, and writes nothing', async () => {
		const bad = MARKDOWN_DECK.replace('## a', 'Stray words here\n\n## a');
		const { response, body } = await importMarkdown(bad);
		expect(response.status).toBe(422);
		expect(response.headers.get('x-request-id')).toBe('req-1');
		expect(body.error.code).toBe('validation_failed');
		expect(body.error.details.errors[0]).toMatchObject({
			code: 'text_before_first_card',
			line: 7
		});
		expect(deckCount()).toBe(0);
	});

	it('puts validator errors on the line of the field that caused them', async () => {
		const bad = MARKDOWN_DECK.replace('Cloze: The {{c1::DR}}', 'Cloze: The {{c1::DR');
		const { response, body } = await importMarkdown(bad);
		expect(response.status).toBe(422);
		expect(body.error.details.errors[0]).toMatchObject({
			path: 'cards[1].text',
			code: 'unclosed_cloze',
			line: 12
		});
	});

	it('says so when a JSON deck is sent as Markdown, and the other way round', async () => {
		const jsonAsMarkdown = await importMarkdown(JSON.stringify(deck(twoCards())));
		expect(jsonAsMarkdown.response.status).toBe(422);
		expect(jsonAsMarkdown.body.error.details.errors[0].code).toBe('not_markdown_is_json');

		const markdownAsJson = await importDeck(MARKDOWN_DECK);
		expect(markdownAsJson.response.status).toBe(422);
		expect(markdownAsJson.body.error.details.errors[0].code).toBe('not_json_is_markdown');
		expect(deckCount()).toBe(0);
	});

	it('refuses an over-limit Markdown body, declared or not', async () => {
		const declared = await handleImport(
			app,
			new Request('http://localhost/api/import', {
				method: 'POST',
				headers: { 'content-type': 'text/markdown', 'content-length': String(5 * 1024 * 1024 + 1) },
				body: MARKDOWN_DECK
			}),
			'req-1'
		);
		expect(declared.status).toBe(413);

		const { response, body } = await importMarkdown(' '.repeat(5 * 1024 * 1024 + 1));
		expect(response.status).toBe(413);
		expect(body.error.code).toBe('payload_too_large');
	});

	it('never lets Markdown content reach the log', async () => {
		await importMarkdown(MARKDOWN_DECK.replace('A: A a', 'A: SECRET BACK'));
		expect(logged.find((l) => l['msg'] === 'import committed')).toMatchObject({ deckId: 'ccna' });
		expect(JSON.stringify(logged)).not.toContain('SECRET');
	});
});

describe('GET /api/decks', () => {
	it('starts empty', async () => {
		expect(await handleListDecks(app).json()).toEqual({
			decks: [],
			folders: [],
			totals: { learning: 0, review: 0, new: 0 },
			openLeeches: 0
		});
	});

	it('counts the leeches that still need attention, and not suspended ones', async () => {
		await importDeck(
			deck([
				{ id: 'a', type: 'basic', front: 'Q a', back: 'A a' },
				{ id: 'b', type: 'basic', front: 'Q b', back: 'A b' },
				{ id: 'c', type: 'basic', front: 'Q c', back: 'A c' }
			])
		);
		const pk = (key: string) => app.db.select().from(cards).where(eq(cards.key, key)).get()!.pk;
		for (const key of ['a', 'b']) {
			app.db
				.update(cardState)
				.set({ leech: true, lapses: 9 })
				.where(eq(cardState.cardPk, pk(key)))
				.run();
		}
		expect((await handleListDecks(app).json()).openLeeches).toBe(2);
		app.db
			.update(cards)
			.set({ suspended: true })
			.where(eq(cards.pk, pk('b')))
			.run();
		expect((await handleListDecks(app).json()).openLeeches).toBe(1);
	});

	it('lists decks with their active card counts', async () => {
		await importDeck(deck(twoCards(), { description: 'Exam prep', tags: ['net'] }));
		await importDeck(
			deck([{ id: 'x', type: 'basic', front: 'Q', back: 'A' }], { id: 'other', title: 'Other' })
		);
		await importDeck(deck([twoCards()[0]!]), '?archive_missing=true');

		const { decks, totals } = await handleListDecks(app).json();
		expect(decks).toEqual([
			{
				id: 'ccna',
				title: 'CCNA',
				description: 'Exam prep',
				tags: ['net'],
				cardCount: 1,
				createdAt: '2026-10-10T12:00:00.000Z',
				updatedAt: expect.any(String),
				folderId: null,
				counts: { learning: 0, review: 0, new: 1 }
			},
			expect.objectContaining({
				id: 'other',
				cardCount: 1,
				description: null,
				tags: [],
				counts: { learning: 0, review: 0, new: 1 }
			})
		]);
		// Totals are what one session across every deck would serve.
		expect(totals).toEqual({ learning: 0, review: 0, new: 2 });
	});

	it('reports the cloze blanks as separate items in the counts', async () => {
		await importDeck(deck([twoCards()[1]!])); // one cloze card with two blanks
		const { decks } = await handleListDecks(app).json();
		expect(decks[0].cardCount).toBe(1);
		expect(decks[0].counts.new).toBe(2);
	});
});
