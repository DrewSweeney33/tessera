import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCard } from '#lib/core/schema/normalize.ts';
import { validateDeck, type Deck } from '#lib/core/schema/index.ts';
import {
	parseJson,
	parseMarkdown,
	serializeJson,
	serializeMarkdown
} from '#lib/core/parse/index.ts';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { commitImport, planImport } from '#lib/server/import/index.ts';
import { exportDeck, renderDeckExport } from '#lib/server/export/index.ts';
import { getDeck, listCardsForDeck, setCardsArchived } from '#lib/server/repos/index.ts';
import { decks } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Export is the inverse of import (ADR-013): what a deck holds goes out as a deck document, and importing that
// document again changes nothing and creates nothing. The editor will be built on this, so the guarantee is
// tested on every golden deck, on both file formats, and on generated decks.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock('2026-10-12T12:00:00.000Z');
	handle = openDatabase({ dataDir: dir.path, clock });
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

function commit(deck: Deck): void {
	const result = commitImport(handle.db, deck, { archiveMissing: false, format: 'json' }, clock);
	if (!result.ok) throw new Error(`commit failed: ${JSON.stringify(result.error)}`);
}

// Importing this deck again must change nothing: every card unchanged, nothing new, nothing absent.
function expectNothingToChange(deck: Deck): void {
	const plan = planImport(handle.db, deck, { archiveMissing: false });
	if (!plan.ok) throw new Error(`plan failed: ${JSON.stringify(plan.error)}`);
	expect(plan.value.counts).toEqual({
		new: 0,
		updated: 0,
		typeChanged: 0,
		restored: 0,
		unchanged: deck.cards.length,
		absent: 0,
		archivedMissing: 0
	});
	expect(plan.value.deck.changed).toBe(false);
}

const normalized = (deck: Deck) => deck.cards.map((card) => normalizeCard(card));

describe('exportDeck', () => {
	it('returns a deck that validates, with the stored title, description, tags, and cards in order', () => {
		commit(
			makeDeck([basic('a'), cloze('b', 'The {{c1::DR}} and {{c2::BDR}}'), basic('c')], {
				title: 'CCNA',
				description: 'OSPF notes',
				tags: ['ospf', 'ccna']
			})
		);
		const exported = exportDeck(handle.db, 'd1');
		expect(exported).toBeDefined();
		expect(validateDeck(JSON.parse(JSON.stringify(exported))).ok).toBe(true);
		expect(exported!.tessera).toBe(1);
		expect(exported!.deck).toEqual({
			id: 'd1',
			title: 'CCNA',
			description: 'OSPF notes',
			tags: ['ospf', 'ccna']
		});
		expect(exported!.cards.map((card) => card.id)).toEqual(['a', 'b', 'c']);
	});

	it('leaves out a description and tags the deck does not have', () => {
		commit(makeDeck([basic('a')]));
		const exported = exportDeck(handle.db, 'd1')!;
		expect(exported.deck).toEqual({ id: 'd1', title: 'Test deck' });
	});

	it('keeps the order of the file after the file was changed and re-imported', () => {
		commit(makeDeck([basic('a'), basic('b'), basic('c')]));
		commit(makeDeck([basic('c'), basic('a'), basic('b')]));
		expect(exportDeck(handle.db, 'd1')!.cards.map((card) => card.id)).toEqual(['c', 'a', 'b']);
	});

	it('leaves out cards that were removed (archived)', () => {
		commit(makeDeck([basic('a'), basic('b'), basic('c')]));
		const b = listCardsForDeck(handle.db, 'd1').find((card) => card.key === 'b')!;
		setCardsArchived(handle.db, [b.pk], true, clock.now().toISOString());
		expect(exportDeck(handle.db, 'd1')!.cards.map((card) => card.id)).toEqual(['a', 'c']);
	});

	it('has nothing to export for an unknown deck or a deck in the Trash', () => {
		expect(exportDeck(handle.db, 'nope')).toBeUndefined();
		commit(makeDeck([basic('a')]));
		handle.db.update(decks).set({ archived: true }).where(eq(decks.id, 'd1')).run();
		expect(getDeck(handle.db, 'd1')?.archived).toBe(true);
		expect(exportDeck(handle.db, 'd1')).toBeUndefined();
	});

	it('exports every field of all four card types, including hint, source, and tags', () => {
		const original = makeDeck([
			{ id: 'b', type: 'basic', front: 'Q', back: 'A', hint: 'h', tags: ['x'], source: 'Lesson 1' },
			{ id: 'c', type: 'cloze', text: 'A {{c1::cloze}} here', extra: 'More', hint: 'h2' },
			{ id: 't', type: 'typed', front: 'Q', answer: 'ans', accept: ['alt', 'other'] },
			{
				id: 'm',
				type: 'choice',
				front: 'Q',
				choices: ['one', 'two', 'three'],
				correct: 2,
				explanation: 'Because'
			}
		]);
		commit(original);
		expect(normalized(exportDeck(handle.db, 'd1')!)).toEqual(normalized(original));
	});
});

describe('the round trip: export, then import again', () => {
	const folder = 'tests/fixtures/decks/valid';
	const fixtures = readdirSync(folder).filter((name) => name.endsWith('.json'));

	it('has golden decks to run against', () => {
		expect(fixtures.length).toBeGreaterThanOrEqual(4);
	});

	it.each(fixtures)('changes nothing and creates nothing for %s', (name) => {
		const parsed = validateDeck(JSON.parse(readFileSync(join(folder, name), 'utf8')));
		if (!parsed.ok) throw new Error(`fixture ${name} is invalid`);
		const original = parsed.value;
		commit(original);

		const exported = exportDeck(handle.db, original.deck.id)!;
		expect(exported.cards).toHaveLength(original.cards.length);
		expectNothingToChange(exported);
		// What went out is what went in, once both are reduced to what identity and change detection care about.
		expect(
			normalized(exported).map(({ type, content, tags, source }) => ({
				type,
				content,
				tags,
				source
			}))
		).toEqual(
			normalized(original).map(({ type, content, tags, source }) => ({
				type,
				content,
				tags,
				source
			}))
		);
	});

	it.each(fixtures)('survives a trip through JSON text for %s', (name) => {
		const original = validateDeck(JSON.parse(readFileSync(join(folder, name), 'utf8')));
		if (!original.ok) throw new Error('invalid fixture');
		commit(original.value);
		const text = serializeJson(exportDeck(handle.db, original.value.deck.id)!);
		const reparsed = parseJson(text);
		if (!reparsed.ok)
			throw new Error(`exported JSON did not parse: ${JSON.stringify(reparsed.error)}`);
		expectNothingToChange(reparsed.value);
	});

	it.each(fixtures)(
		'survives a trip through Markdown text for %s, when it can be written',
		(name) => {
			const original = validateDeck(JSON.parse(readFileSync(join(folder, name), 'utf8')));
			if (!original.ok) throw new Error('invalid fixture');
			commit(original.value);
			const exported = exportDeck(handle.db, original.value.deck.id)!;
			const text = serializeMarkdown(exported);
			if (!text.ok) return; // some content cannot be written as Markdown, and JSON is the reference
			const reparsed = parseMarkdown(text.value);
			if (!reparsed.ok)
				throw new Error(`exported Markdown did not parse: ${JSON.stringify(reparsed.error)}`);
			expectNothingToChange(reparsed.value);
		}
	);

	it('gives cards that had no id a stable one, so exporting and importing again keeps them', () => {
		const original = validateDeck(JSON.parse(readFileSync(join(folder, 'no-ids.json'), 'utf8')));
		if (!original.ok) throw new Error('invalid fixture');
		commit(original.value);
		const exported = exportDeck(handle.db, original.value.deck.id)!;
		for (const card of exported.cards) expect(card.id).toMatch(/^h-[0-9a-f]{12}$/);
		expectNothingToChange(exported);
	});

	it('holds for generated decks of all four card types (property test)', () => {
		const word = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.?!'-]{0,30}[A-Za-z0-9]$/);
		const cardArb = fc.oneof(
			fc.record({ type: fc.constant('basic'), front: word, back: word }),
			fc.record({ type: fc.constant('typed'), front: word, answer: word }),
			fc
				.record({ word, other: word })
				.map(({ word: w, other }) => ({ type: 'cloze', text: `${other} {{c1::${w}}}` })),
			fc
				.record({ front: word, choices: fc.uniqueArray(word, { minLength: 2, maxLength: 5 }) })
				.chain(({ front, choices }) =>
					fc.nat(choices.length - 1).map((correct) => ({ type: 'choice', front, choices, correct }))
				)
		);
		let run = 0;
		fc.assert(
			fc.property(fc.array(cardArb, { minLength: 1, maxLength: 12 }), (cards) => {
				run++;
				const id = `gen-${run}`;
				const deck = makeDeck(
					cards.map((card, index) => ({ ...card, id: `c${index}` })),
					{ id, title: `Generated ${run}` }
				);
				commit(deck);
				const exported = exportDeck(handle.db, id)!;
				expectNothingToChange(exported);
				expect(exported.cards.map((card) => card.id)).toEqual(deck.cards.map((card) => card.id));
			}),
			{ numRuns: 60 }
		);
	});
});

describe('renderDeckExport', () => {
	it('renders JSON with the file name and content type of the deck', () => {
		commit(makeDeck([basic('a')], { id: 'my-deck' }));
		const rendered = renderDeckExport(exportDeck(handle.db, 'my-deck')!, 'json');
		expect(rendered.ok).toBe(true);
		if (!rendered.ok) return;
		expect(rendered.value.filename).toBe('my-deck.json');
		expect(rendered.value.contentType).toBe('application/json; charset=utf-8');
		expect(JSON.parse(rendered.value.body).deck.id).toBe('my-deck');
	});

	it('renders Markdown with the right name and content type', () => {
		commit(makeDeck([basic('a')], { id: 'my-deck' }));
		const rendered = renderDeckExport(exportDeck(handle.db, 'my-deck')!, 'markdown');
		expect(rendered.ok).toBe(true);
		if (!rendered.ok) return;
		expect(rendered.value.filename).toBe('my-deck.md');
		expect(rendered.value.contentType).toBe('text/markdown; charset=utf-8');
		expect(rendered.value.body).toContain('## a');
	});

	it('says so, and names the card, when a deck cannot be written as Markdown', () => {
		commit(makeDeck([basic('a', '  indented first line', 'A')]));
		const rendered = renderDeckExport(exportDeck(handle.db, 'd1')!, 'markdown');
		expect(rendered.ok).toBe(false);
		if (rendered.ok) return;
		expect(rendered.error.message).toMatch(/Markdown/);
		expect(rendered.error.message).toMatch(/JSON/);
		expect(rendered.error.problems.length).toBeGreaterThan(0);
	});

	it('only ever puts a safe file name in the header, whatever the deck id is', () => {
		commit(makeDeck([basic('a')], { id: 'ok-deck-1' }));
		const rendered = renderDeckExport(exportDeck(handle.db, 'ok-deck-1')!, 'json');
		if (!rendered.ok) throw new Error('should render');
		expect(rendered.value.filename).toMatch(/^[a-z0-9][a-z0-9-]*\.(json|md)$/);
	});
});
