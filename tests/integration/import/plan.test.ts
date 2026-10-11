import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { planImport, type ImportPlan } from '#lib/server/import/index.ts';
import { setCardsArchived, setStatesArchived } from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;
let handle: DatabaseHandle;

beforeEach(() => {
	dir = makeTempDir();
	handle = openDatabase({ dataDir: dir.path, clock: fakeClock() });
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

function plan(deck: ReturnType<typeof makeDeck>, archiveMissing = false): ImportPlan {
	const result = planImport(handle.db, deck, { archiveMissing });
	if (!result.ok) throw new Error(`plan failed: ${JSON.stringify(result.error)}`);
	return result.value;
}

function actions(p: ImportPlan): Record<string, string> {
	return Object.fromEntries(p.cards.map((c) => [c.key, c.action]));
}

function tableCounts(): Record<string, number> {
	const count = (table: string) =>
		(handle.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
	return {
		decks: count('decks'),
		cards: count('cards'),
		card_state: count('card_state'),
		import_history: count('import_history'),
		review_log: count('review_log')
	};
}

const threeCards = () => [basic('a'), basic('b'), basic('c')];

describe('planImport: a deck that does not exist yet', () => {
	it('plans every card as new with one review item each', () => {
		const p = plan(makeDeck(threeCards()));
		expect(p.deck).toMatchObject({ id: 'd1', action: 'created', changed: true });
		expect(actions(p)).toEqual({ a: 'new', b: 'new', c: 'new' });
		expect(p.counts).toEqual({
			new: 3,
			updated: 0,
			typeChanged: 0,
			restored: 0,
			unchanged: 0,
			absent: 0,
			archivedMissing: 0
		});
		expect(p.cards.map((c) => [c.key, c.index, c.ordinalsToAdd])).toEqual([
			['a', 0, [0]],
			['b', 1, [0]],
			['c', 2, [0]]
		]);
	});

	it('plans one review item per cloze number', () => {
		const p = plan(
			makeDeck([cloze('dr', 'The {{c1::DR}} uses {{c2::priority}} then {{c3::ID}}.')])
		);
		expect(p.cards[0]!.ordinalsToAdd).toEqual([1, 2, 3]);
	});

	it('does not write anything', () => {
		const before = tableCounts();
		plan(makeDeck(threeCards()));
		expect(tableCounts()).toEqual(before);
	});
});

describe('planImport: re-importing an existing deck', () => {
	beforeEach(() => {
		seedDeck(handle.db, makeDeck(threeCards()));
	});

	it('reports an identical deck as all unchanged', () => {
		const p = plan(makeDeck(threeCards()));
		expect(p.deck).toMatchObject({ action: 'updated', changed: false });
		expect(p.counts).toMatchObject({ new: 0, updated: 0, unchanged: 3, absent: 0 });
		expect(p.cards.every((c) => !c.reposition && c.ordinalsToAdd.length === 0)).toBe(true);
	});

	it('detects a changed answer and names the changed field', () => {
		const p = plan(makeDeck([basic('a'), basic('b', 'Q b', 'A b, revised'), basic('c')]));
		expect(actions(p)).toEqual({ a: 'unchanged', b: 'updated', c: 'unchanged' });
		expect(p.cards[1]!.changedFields).toEqual(['back']);
		expect(p.cards[1]!.existingPk).toBeDefined();
		expect(p.cards[1]!.resetProgress).toBe(false);
	});

	it('detects tag and source changes as updates', () => {
		const p = plan(
			makeDeck([
				basic('a', 'Q a', 'A a', { tags: ['new'] }),
				basic('b', 'Q b', 'A b', { source: 'L1' }),
				basic('c')
			])
		);
		expect(p.cards[0]!.changedFields).toEqual(['tags']);
		expect(p.cards[1]!.changedFields).toEqual(['source']);
	});

	it('detects an added hint', () => {
		const p = plan(makeDeck([basic('a', 'Q a', 'A a', { hint: 'think' }), basic('b'), basic('c')]));
		expect(p.cards[0]!.changedFields).toEqual(['hint']);
	});

	it('ignores cosmetic differences: line endings, trailing space, tag order', () => {
		seedDeck(
			handle.db,
			makeDeck([basic('t', 'Line\nTwo', 'A', { tags: ['x', 'y'] })], { id: 'cosmetic' })
		);
		const p = plan(
			makeDeck([basic('t', 'Line\r\nTwo  ', 'A', { tags: ['y', 'x'] })], { id: 'cosmetic' })
		);
		expect(actions(p)).toEqual({ t: 'unchanged' });
	});

	it('treats a position-only change as unchanged but flags the reposition', () => {
		const p = plan(makeDeck([basic('c'), basic('a'), basic('b')]));
		expect(p.counts.unchanged).toBe(3);
		expect(Object.fromEntries(p.cards.map((c) => [c.key, c.reposition]))).toEqual({
			c: true,
			a: true,
			b: true
		});
	});

	it('reports new cards added alongside existing ones', () => {
		const p = plan(makeDeck([...threeCards(), basic('d')]));
		expect(p.counts).toMatchObject({ new: 1, unchanged: 3 });
		expect(p.cards[3]).toMatchObject({ key: 'd', action: 'new', index: 3 });
	});

	it('updates deck metadata and reports it as changed', () => {
		const p = plan(makeDeck(threeCards(), { title: 'Renamed', description: 'Now described' }));
		expect(p.deck).toMatchObject({ changed: true, title: 'Renamed', description: 'Now described' });
	});
});

describe('planImport: cards missing from the file', () => {
	beforeEach(() => {
		seedDeck(handle.db, makeDeck(threeCards()));
	});

	it('leaves them untouched by default', () => {
		const p = plan(makeDeck([basic('a')]));
		expect(p.absent.map((c) => c.key).sort()).toEqual(['b', 'c']);
		expect(p.toArchive).toEqual([]);
		expect(p.counts).toMatchObject({ absent: 2, archivedMissing: 0 });
	});

	it('archives absent active cards when asked, but not ones already archived', () => {
		const pks = new Map(
			(
				handle.sqlite.prepare('select pk, key from cards').all() as { pk: number; key: string }[]
			).map((r) => [r.key, r.pk])
		);
		setCardsArchived(handle.db, [pks.get('c')!], true, '2026-10-10T12:00:00.000Z');
		const p = plan(makeDeck([basic('a')]), true);
		expect(p.toArchive).toEqual([pks.get('b')]);
		expect(p.counts).toMatchObject({ absent: 2, archivedMissing: 1 });
		expect(p.absent.find((c) => c.key === 'c')?.archived).toBe(true);
	});
});

describe('planImport: archived cards that come back', () => {
	let pks: Map<string, number>;
	beforeEach(() => {
		pks = new Map(Object.entries(Object.fromEntries(seedDeck(handle.db, makeDeck(threeCards())))));
		setCardsArchived(handle.db, [pks.get('b')!], true, '2026-10-10T12:00:00.000Z');
	});

	it('restores an unchanged archived card', () => {
		const p = plan(makeDeck(threeCards()));
		expect(actions(p)).toEqual({ a: 'unchanged', b: 'restored', c: 'unchanged' });
		expect(p.cards[1]!.restored).toBe(true);
		expect(p.counts).toMatchObject({ restored: 1, unchanged: 2 });
	});

	it('reports an archived card that also changed as updated and restored', () => {
		const p = plan(makeDeck([basic('a'), basic('b', 'Q b', 'new answer'), basic('c')]));
		expect(p.cards[1]).toMatchObject({
			action: 'updated',
			restored: true,
			changedFields: ['back']
		});
	});
});

describe('planImport: changing a card type', () => {
	it('flags the change and resets progress', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		const p = plan(makeDeck([{ id: 'a', type: 'typed', front: 'Q a', answer: 'A a' }]));
		expect(p.cards[0]).toMatchObject({
			action: 'type_changed',
			resetProgress: true,
			ordinalsToAdd: [0]
		});
		expect(p.counts.typeChanged).toBe(1);
	});

	it('resets progress when a basic card becomes a cloze card', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		const p = plan(makeDeck([cloze('a', '{{c1::x}} and {{c2::y}}')]));
		expect(p.cards[0]).toMatchObject({ action: 'type_changed', ordinalsToAdd: [1, 2] });
	});
});

describe('planImport: cloze numbers', () => {
	let pk: number;
	beforeEach(() => {
		pk = seedDeck(handle.db, makeDeck([cloze('dr', '{{c1::a}} {{c2::b}}')])).get('dr')!;
	});

	it('adds new numbers', () => {
		const p = plan(makeDeck([cloze('dr', '{{c1::a}} {{c2::b}} {{c3::c}}')]));
		expect(p.cards[0]).toMatchObject({
			action: 'updated',
			ordinalsToAdd: [3],
			ordinalsToArchive: [],
			ordinalsToRestore: []
		});
	});

	it('archives removed numbers', () => {
		const p = plan(makeDeck([cloze('dr', '{{c1::a}} only')]));
		expect(p.cards[0]).toMatchObject({ ordinalsToArchive: [2], ordinalsToAdd: [] });
	});

	it('restores a number that returns after being archived', () => {
		setStatesArchived(handle.db, pk, [2], true);
		const p = plan(makeDeck([cloze('dr', '{{c1::a}} {{c2::b}}')]));
		expect(p.cards[0]).toMatchObject({
			action: 'unchanged',
			ordinalsToRestore: [2],
			ordinalsToAdd: [],
			ordinalsToArchive: []
		});
	});

	it('does not re-archive a number that is already archived', () => {
		setStatesArchived(handle.db, pk, [2], true);
		const p = plan(makeDeck([cloze('dr', '{{c1::a}} only')]));
		expect(p.cards[0]!.ordinalsToArchive).toEqual([]);
	});
});

describe('planImport: cards without ids', () => {
	const noIds = () => [
		{ type: 'basic', front: 'Capital of France?', back: 'Paris' },
		{ type: 'cloze', text: 'The {{c1::sky}} is blue.' }
	];

	it('derives stable keys and warns that editing the text creates a new card', () => {
		const p = plan(makeDeck(noIds()));
		expect(p.cards.every((c) => c.generatedKey && /^h-[0-9a-f]{12}$/.test(c.key))).toBe(true);
		expect(p.warnings).toHaveLength(1);
		expect(p.warnings[0]).toMatchObject({ code: 'generated_id', paths: ['cards[0]', 'cards[1]'] });
		expect(p.warnings[0]!.message).toContain('2 cards have no id');
	});

	it('recognizes the same cards again, even reordered or with an edited answer', () => {
		seedDeck(handle.db, makeDeck(noIds()));
		const [first, second] = noIds();
		const p = plan(makeDeck([second!, { ...first!, back: 'Paris, France' }]));
		expect(p.counts).toMatchObject({ new: 0, updated: 1, unchanged: 1 });
	});

	it('treats an edited question as a new card and leaves the old one absent', () => {
		seedDeck(handle.db, makeDeck(noIds()));
		const [first, second] = noIds();
		const p = plan(makeDeck([{ ...first!, front: 'What is the capital of France?' }, second!]));
		expect(p.counts).toMatchObject({ new: 1, unchanged: 1, absent: 1 });
	});

	it('rejects two cards that would share one key', () => {
		const deck = makeDeck([
			{ type: 'basic', front: 'Same question', back: 'One' },
			{ type: 'basic', front: 'Same question', back: 'Two' }
		]);
		const result = planImport(handle.db, deck, { archiveMissing: false });
		if (result.ok) throw new Error('expected failure');
		expect(result.error).toHaveLength(1);
		expect(result.error[0]).toMatchObject({ path: 'cards[1]', code: 'duplicate_id' });
		expect(result.error[0]!.message).toContain('cards[0]');
	});

	it('keeps a basic and a typed card with the same question distinct', () => {
		const p = plan(
			makeDeck([
				{ type: 'basic', front: 'Port for HTTPS?', back: '443' },
				{ type: 'typed', front: 'Port for HTTPS?', answer: '443' }
			])
		);
		expect(new Set(p.cards.map((c) => c.key)).size).toBe(2);
	});
});

describe('planImport: isolation', () => {
	it('does not mix up the same card key in two decks', () => {
		seedDeck(handle.db, makeDeck([basic('shared')], { id: 'one' }));
		seedDeck(handle.db, makeDeck([basic('shared', 'Different', 'Different')], { id: 'two' }));
		const p = plan(makeDeck([basic('shared')], { id: 'one' }));
		expect(actions(p)).toEqual({ shared: 'unchanged' });
	});
});
