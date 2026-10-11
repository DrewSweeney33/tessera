import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { planImport, type ImportPlan } from '#lib/server/import/index.ts';
import { setCardsArchived } from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { seedDeck } from '../../helpers/seed-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// What the import preview tells the author: what each edit changes, what a retype erases, and the signs
// that ids were changed in a revised deck (M2-09).

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

const codes = (p: ImportPlan) => p.warnings.map((w) => w.code);
const MISSING_SIGNS = ['ids_changed', 'mostly_replaced'];
const missingSigns = (p: ImportPlan) => codes(p).filter((c) => MISSING_SIGNS.includes(c));

// Marks one review item as studied, so a retype has history to erase.
function study(pk: number, ordinal = 0) {
	handle.sqlite
		.prepare('update card_state set reps = 3, phase = 2 where card_pk = ? and ordinal = ?')
		.run(pk, ordinal);
}

const fresh = (n: number) => basic(`n${n}`, `New question ${n}`, `New answer ${n}`);

describe('what an update changes', () => {
	it('gives the old and new text of each field', () => {
		seedDeck(handle.db, makeDeck([basic('a', 'Q a', 'old answer', { tags: ['x'] })]));
		const p = plan(
			makeDeck([basic('a', 'Q a', 'new answer', { tags: ['x', 'y'], source: 'Ch 4' })])
		);
		expect(p.cards[0]!.changes).toEqual([
			{ field: 'back', before: 'old answer', after: 'new answer' },
			{ field: 'source', before: undefined, after: 'Ch 4' },
			{ field: 'tags', before: 'x', after: 'x, y' }
		]);
		expect(p.cards[0]!.changedFields).toEqual(['back', 'source', 'tags']);
	});

	it('has none for new, unchanged, and repositioned cards', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c')]));
		const p = plan(makeDeck([basic('c'), basic('a'), basic('b'), basic('d')]));
		expect(p.cards.map((c) => [c.key, c.changes.length])).toEqual([
			['c', 0],
			['a', 0],
			['b', 0],
			['d', 0]
		]);
	});
});

describe('what a retype erases', () => {
	it('counts only review items that have history, and says so', () => {
		const pks = seedDeck(handle.db, makeDeck([cloze('c', '{{c1::x}} {{c2::y}}'), basic('b')]));
		study(pks.get('c')!, 1);
		const p = plan(
			makeDeck([
				{ id: 'c', type: 'typed', front: 'Q', answer: 'x' },
				{ id: 'b', type: 'typed', front: 'Q b', answer: 'A b' }
			])
		);
		const [studied, untouched] = p.cards;
		expect(studied).toMatchObject({ action: 'type_changed', progressLost: 1 });
		expect(studied!.changes[0]).toEqual({ field: 'type', before: 'cloze', after: 'typed' });
		expect(untouched).toMatchObject({ action: 'type_changed', progressLost: 0 });

		const warning = p.warnings.find((w) => w.code === 'type_changed')!;
		expect(warning.message).toContain('2 cards change type ("c", "b")');
		expect(warning.message).toContain('1 review item has history that will be erased');
		expect(warning.paths).toEqual(['cards[0]', 'cards[1]']);
	});

	it('says nothing is lost when the retyped card was never studied', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		const p = plan(makeDeck([{ id: 'a', type: 'typed', front: 'Q a', answer: 'A a' }]));
		const warning = p.warnings.find((w) => w.code === 'type_changed')!;
		expect(warning.message).toContain('1 card changes type ("a")');
		expect(warning.message).toContain('None of them has been studied yet');
	});

	it('does not warn when no card changes type', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		expect(codes(plan(makeDeck([basic('a', 'Q a', 'edited')])))).not.toContain('type_changed');
	});
});

describe('signs that ids were changed', () => {
	it('warns when new cards have exactly the content of missing cards, and names the first pair', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c'), basic('d')]));
		const p = plan(
			makeDeck([
				{ ...basic('a'), id: 'alpha' },
				{ ...basic('b'), id: 'beta' },
				basic('c'),
				basic('d')
			])
		);
		const warning = p.warnings.find((w) => w.code === 'ids_changed')!;
		expect(warning.message).toContain('2 new cards have exactly the same content as cards missing');
		expect(warning.message).toContain('"a" is now "alpha"');
		expect(warning.message).toContain('The old cards stay, with their history');
		expect(warning.paths).toEqual(['cards[0]', 'cards[1]']);
		expect(codes(p)).not.toContain('mostly_replaced');
	});

	it('says the old cards would also be archived when that option is on', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		const p = plan(makeDeck([{ ...basic('a'), id: 'alpha' }]), true);
		const warning = p.warnings.find((w) => w.code === 'ids_changed')!;
		expect(warning.message).toContain('the old ones would also be archived');
		expect(warning.message).toContain('1 new card has exactly the same content as a card missing');
	});

	it('matches each missing card at most once', () => {
		seedDeck(handle.db, makeDeck([basic('a')]));
		const p = plan(
			makeDeck([
				{ ...basic('a'), id: 'one' },
				{ ...basic('a'), id: 'two' }
			])
		);
		const warning = p.warnings.find((w) => w.code === 'ids_changed')!;
		expect(warning.message).toContain('1 new card has');
		expect(warning.paths).toEqual(['cards[0]']);
	});

	it('warns when most of a deck is replaced by new cards, even if the text differs', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c'), basic('d')]));
		const p = plan(makeDeck([basic('a'), fresh(1), fresh(2), fresh(3)]));
		const warning = p.warnings.find((w) => w.code === 'mostly_replaced')!;
		expect(warning.message).toContain('3 of the 4 cards in this deck are not in this file');
		expect(warning.message).toContain('adds 3 new ones');
		expect(codes(p)).not.toContain('ids_changed');
	});

	it('warns at exactly half the deck missing, and not just below it', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c'), basic('d')]));
		expect(
			missingSigns(plan(makeDeck([basic('a'), basic('b'), fresh(1), fresh(2), fresh(3)])))
		).toEqual(['mostly_replaced']);
		expect(
			missingSigns(
				plan(makeDeck([basic('a'), basic('b'), basic('c'), fresh(1), fresh(2), fresh(3)]))
			)
		).toEqual([]);
	});

	it('needs at least three new cards, so dropping cards on purpose is quiet', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c'), basic('d')]));
		expect(missingSigns(plan(makeDeck([basic('a'), basic('b')])))).toEqual([]);
		expect(missingSigns(plan(makeDeck([basic('a'), basic('b'), fresh(1), fresh(2)])))).toEqual([]);
	});

	it('needs at least three cards in the deck already', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b')]));
		expect(missingSigns(plan(makeDeck([fresh(1), fresh(2), fresh(3)])))).toEqual([]);
	});

	it('is quiet when a deck only gains cards', () => {
		seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c')]));
		expect(missingSigns(plan(makeDeck([basic('a'), basic('b'), basic('c'), fresh(1)])))).toEqual(
			[]
		);
	});

	it('does not count cards that were already archived as missing', () => {
		const pks = seedDeck(handle.db, makeDeck([basic('a'), basic('b'), basic('c'), basic('d')]));
		setCardsArchived(
			handle.db,
			[pks.get('b')!, pks.get('c')!, pks.get('d')!],
			true,
			'2026-10-10T12:00:00.000Z'
		);
		expect(missingSigns(plan(makeDeck([basic('a'), fresh(1), fresh(2), fresh(3)])))).toEqual([]);
	});

	it('says nothing for a deck that does not exist yet', () => {
		expect(plan(makeDeck([basic('a'), basic('b'), basic('c')])).warnings).toEqual([]);
	});
});
