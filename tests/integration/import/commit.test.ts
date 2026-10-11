import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import {
	commitImport,
	planImport,
	type CommitOptions,
	type ImportResult
} from '#lib/server/import/index.ts';
import {
	getCardByKey,
	getState,
	insertReviewLog,
	listCardsForDeck,
	listImportHistory,
	listStatesForCards,
	updateState
} from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;

const START = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock(START);
	handle = openDatabase({ dataDir: dir.path, clock });
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

function commit(
	deck: ReturnType<typeof makeDeck>,
	options: Partial<CommitOptions> = {}
): ImportResult {
	const result = commitImport(
		handle.db,
		deck,
		{ archiveMissing: false, format: 'json', ...options },
		clock
	);
	if (!result.ok) throw new Error(`commit failed: ${JSON.stringify(result.error)}`);
	return result.value;
}

function dump(): string {
	const tables = ['decks', 'cards', 'card_state', 'review_log', 'import_history', 'settings'];
	return JSON.stringify(
		tables.map((table) => handle.sqlite.prepare(`select * from ${table} order by 1, 2`).all())
	);
}

function totalChanges(): number {
	return (handle.sqlite.prepare('select total_changes() as n').get() as { n: number }).n;
}

function count(table: string): number {
	return (handle.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}

function logReview(cardPk: number, id = 'review-1') {
	insertReviewLog(handle.db, {
		id,
		cardPk,
		ordinal: 0,
		mode: 'review',
		grade: 3,
		preDue: START,
		preStability: 0,
		preDifficulty: 0,
		preElapsedDays: 0,
		preScheduledDays: 0,
		preLearningSteps: 0,
		preReps: 0,
		preLapses: 0,
		prePhase: 0,
		reviewedAt: START
	});
}

const abc = () => [basic('a'), basic('b'), basic('c')];

describe('commitImport: first import', () => {
	it('creates the deck, cards, new review items, and one history row', () => {
		const result = commit(
			makeDeck(
				[
					basic('hello', 'Line\r\nTwo  ', 'A', { tags: ['y', 'x'], source: 'L1' }),
					cloze('dr', '{{c1::a}} {{c2::b}}')
				],
				{ id: 'ccna', title: 'CCNA', description: 'Exam prep', tags: ['net'] }
			),
			{ filename: 'ccna.json' }
		);

		expect(result).toMatchObject({
			deckId: 'ccna',
			changed: true,
			counts: { new: 2, updated: 0, unchanged: 0 }
		});

		const deck = handle.sqlite.prepare("select * from decks where id = 'ccna'").get();
		expect(deck).toMatchObject({
			title: 'CCNA',
			description: 'Exam prep',
			tags: '["net"]',
			archived: 0,
			created_at: START,
			updated_at: START
		});

		const cards = listCardsForDeck(handle.db, 'ccna');
		expect(cards.map((c) => [c.key, c.type, c.position])).toEqual([
			['hello', 'basic', 0],
			['dr', 'cloze', 1]
		]);
		expect(cards[0]).toMatchObject({
			content: { front: 'Line\nTwo', back: 'A' },
			tags: ['x', 'y'],
			source: 'L1',
			archived: false,
			suspended: false
		});
		expect(cards[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);

		const states = listStatesForCards(
			handle.db,
			cards.map((c) => c.pk)
		);
		expect(
			states.map((s) => [s.cardPk === cards[0]!.pk ? 'hello' : 'dr', s.ordinal]).sort()
		).toEqual([
			['dr', 1],
			['dr', 2],
			['hello', 0]
		]);
		expect(
			states.every((s) => s.phase === 0 && s.reps === 0 && s.due === START && !s.archived)
		).toBe(true);

		const history = listImportHistory(handle.db);
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			deckId: 'ccna',
			format: 'json',
			filename: 'ccna.json',
			newCount: 2,
			updatedCount: 0,
			unchangedCount: 0,
			archivedCount: 0,
			createdAt: START
		});
	});

	it('imports many cards in one go', () => {
		const cards = Array.from({ length: 2000 }, (_, i) => basic(`c${i}`));
		const started = performance.now();
		const result = commit(makeDeck(cards));
		const elapsed = performance.now() - started;
		expect(result.counts.new).toBe(2000);
		expect(count('cards')).toBe(2000);
		expect(count('card_state')).toBe(2000);
		expect(elapsed).toBeLessThan(5000);
	});
});

describe('commitImport: idempotence', () => {
	it('writes nothing at all when the same deck is imported again', () => {
		commit(makeDeck(abc()));
		const before = dump();
		const changesBefore = totalChanges();

		clock.advance(DAY);
		const again = commit(makeDeck(abc()));

		expect(again).toMatchObject({
			changed: false,
			importHistoryId: undefined,
			counts: { new: 0, updated: 0, unchanged: 3 }
		});
		expect(totalChanges()).toBe(changesBefore);
		expect(dump()).toBe(before);
		expect(count('import_history')).toBe(1);
	});

	it('is not fooled by a preview that went stale', () => {
		const deck = makeDeck(abc());
		const preview = planImport(handle.db, deck, { archiveMissing: false });
		expect(preview.ok && preview.value.counts.new).toBe(3);

		commit(deck); // another import lands first
		const second = commit(deck); // applying the old plan would violate the unique key
		expect(second.counts).toMatchObject({ new: 0, unchanged: 3 });
		expect(count('cards')).toBe(3);
	});
});

describe('commitImport: updating cards keeps review progress', () => {
	it('replaces content but keeps the schedule and the history', () => {
		commit(makeDeck(abc()));
		const card = getCardByKey(handle.db, 'd1', 'b')!;
		updateState(handle.db, card.pk, 0, {
			phase: 2,
			stability: 12.5,
			difficulty: 4.2,
			reps: 5,
			lapses: 1,
			lastReview: START,
			due: '2026-10-25T12:00:00.000Z'
		});
		logReview(card.pk);

		clock.advance(DAY);
		const result = commit(makeDeck([basic('a'), basic('b', 'Q b', 'A b, rewritten'), basic('c')]));

		expect(result.counts).toMatchObject({ updated: 1, unchanged: 2 });
		const after = getCardByKey(handle.db, 'd1', 'b')!;
		expect(after.pk).toBe(card.pk);
		expect(after.content).toEqual({ front: 'Q b', back: 'A b, rewritten' });
		expect(after.createdAt).toBe(START);
		expect(after.updatedAt).toBe('2026-10-11T12:00:00.000Z');
		expect(getState(handle.db, card.pk, 0)).toMatchObject({
			phase: 2,
			stability: 12.5,
			difficulty: 4.2,
			reps: 5,
			lapses: 1,
			due: '2026-10-25T12:00:00.000Z'
		});
		expect(count('review_log')).toBe(1);
		expect(listImportHistory(handle.db)[0]).toMatchObject({
			updatedCount: 1,
			unchangedCount: 2,
			newCount: 0
		});
	});

	it('applies a reposition silently without counting it as a change', () => {
		commit(makeDeck(abc()));
		const updatedAt = getCardByKey(handle.db, 'd1', 'a')!.updatedAt;
		clock.advance(DAY);

		const result = commit(makeDeck([basic('c'), basic('a'), basic('b')]));

		expect(result).toMatchObject({ changed: false, counts: { unchanged: 3 } });
		expect(listCardsForDeck(handle.db, 'd1').map((c) => c.key)).toEqual(['c', 'a', 'b']);
		expect(getCardByKey(handle.db, 'd1', 'a')!.updatedAt).toBe(updatedAt);
		expect(count('import_history')).toBe(1);
	});

	it('never erases a description or tags just because a revised file leaves them out', () => {
		commit(makeDeck(abc(), { description: 'Exam prep', tags: ['net'] }));
		clock.advance(DAY);
		const revised = commit(makeDeck(abc()));
		expect(revised.changed).toBe(false);
		expect(handle.sqlite.prepare("select * from decks where id = 'd1'").get()).toMatchObject({
			description: 'Exam prep',
			tags: '["net"]',
			updated_at: START
		});

		clock.advance(DAY);
		const cleared = commit(makeDeck(abc(), { description: '', tags: [] }));
		expect(cleared.changed).toBe(true);
		expect(handle.sqlite.prepare("select * from decks where id = 'd1'").get()).toMatchObject({
			description: '',
			tags: '[]'
		});
	});

	it('updates deck metadata', () => {
		commit(makeDeck(abc()));
		clock.advance(DAY);
		const result = commit(makeDeck(abc(), { title: 'Renamed', description: 'New description' }));
		expect(result.changed).toBe(true);
		expect(handle.sqlite.prepare("select * from decks where id = 'd1'").get()).toMatchObject({
			title: 'Renamed',
			description: 'New description',
			created_at: START,
			updated_at: '2026-10-11T12:00:00.000Z'
		});
	});
});

describe('commitImport: changing a card type', () => {
	it('replaces the schedule but keeps the review log', () => {
		commit(makeDeck([basic('a')]));
		const card = getCardByKey(handle.db, 'd1', 'a')!;
		updateState(handle.db, card.pk, 0, { phase: 2, reps: 7, stability: 20 });
		logReview(card.pk);

		const result = commit(makeDeck([{ id: 'a', type: 'typed', front: 'Q a', answer: 'A a' }]));

		expect(result.counts.typeChanged).toBe(1);
		const after = getCardByKey(handle.db, 'd1', 'a')!;
		expect(after).toMatchObject({ pk: card.pk, type: 'typed' });
		expect(listStatesForCards(handle.db, [card.pk])).toMatchObject([
			{ ordinal: 0, phase: 0, reps: 0, stability: 0 }
		]);
		expect(count('review_log')).toBe(1);
		expect(listImportHistory(handle.db)[0]).toMatchObject({ updatedCount: 1 });
	});

	it('creates one item per cloze number when a basic card becomes a cloze card', () => {
		commit(makeDeck([basic('a')]));
		commit(makeDeck([cloze('a', '{{c1::x}} {{c2::y}}')]));
		const pk = getCardByKey(handle.db, 'd1', 'a')!.pk;
		expect(
			listStatesForCards(handle.db, [pk])
				.map((s) => s.ordinal)
				.sort()
		).toEqual([1, 2]);
	});
});

describe('commitImport: cloze numbers over time', () => {
	it('adds, archives, and restores items while keeping their progress', () => {
		commit(makeDeck([cloze('dr', '{{c1::a}} {{c2::b}}')]));
		const pk = getCardByKey(handle.db, 'd1', 'dr')!.pk;
		updateState(handle.db, pk, 2, { reps: 4, stability: 9 });

		commit(makeDeck([cloze('dr', '{{c1::a}} {{c2::b}} {{c3::c}}')]));
		expect(listStatesForCards(handle.db, [pk]).map((s) => [s.ordinal, s.archived])).toEqual([
			[1, false],
			[2, false],
			[3, false]
		]);

		commit(makeDeck([cloze('dr', '{{c1::a}} only')]));
		expect(getState(handle.db, pk, 2)).toMatchObject({ archived: true, reps: 4, stability: 9 });
		expect(getState(handle.db, pk, 3)?.archived).toBe(true);
		expect(getState(handle.db, pk, 1)?.archived).toBe(false);

		commit(makeDeck([cloze('dr', '{{c1::a}} {{c2::b again}}')]));
		expect(getState(handle.db, pk, 2)).toMatchObject({ archived: false, reps: 4, stability: 9 });
		expect(getState(handle.db, pk, 3)?.archived).toBe(true);
	});
});

describe('commitImport: cards missing from the file', () => {
	it('leaves them alone unless asked, then archives them, then restores them on return', () => {
		commit(makeDeck(abc()));

		const keep = commit(makeDeck([basic('a')]));
		expect(keep.counts).toMatchObject({ absent: 2, archivedMissing: 0 });
		expect(listCardsForDeck(handle.db, 'd1').every((c) => !c.archived)).toBe(true);

		const archive = commit(makeDeck([basic('a')]), { archiveMissing: true });
		expect(archive).toMatchObject({ changed: true, counts: { archivedMissing: 2 } });
		expect(
			listCardsForDeck(handle.db, 'd1')
				.filter((c) => c.archived)
				.map((c) => c.key)
				.sort()
		).toEqual(['b', 'c']);
		expect(listImportHistory(handle.db)[0]).toMatchObject({ archivedCount: 2 });

		const back = commit(makeDeck(abc()));
		expect(back.counts).toMatchObject({ restored: 2, unchanged: 1, new: 0 });
		expect(listCardsForDeck(handle.db, 'd1').every((c) => !c.archived)).toBe(true);
		expect(listImportHistory(handle.db)[0]).toMatchObject({ updatedCount: 2 });
	});

	it('does not archive cards that belong to another deck', () => {
		commit(makeDeck(abc(), { id: 'one' }));
		commit(makeDeck([basic('x')], { id: 'two' }));
		commit(makeDeck([basic('a')], { id: 'one' }), { archiveMissing: true });
		expect(listCardsForDeck(handle.db, 'two').every((c) => !c.archived)).toBe(true);
	});
});

describe('commitImport: failures roll back everything', () => {
	it('undoes the deck, cards, and states when the last step fails', () => {
		handle.sqlite.exec(
			"create trigger fail_history before insert on import_history begin select raise(abort, 'history write failed'); end"
		);
		expect(() => commit(makeDeck(abc()))).toThrow(/history write failed/);
		expect(count('decks')).toBe(0);
		expect(count('cards')).toBe(0);
		expect(count('card_state')).toBe(0);
	});

	it('undoes earlier cards when a later card fails, and the database stays usable', () => {
		handle.sqlite.exec(
			"create trigger fail_card before insert on cards when new.key = 'c' begin select raise(abort, 'card write failed'); end"
		);
		expect(() => commit(makeDeck(abc()))).toThrow(/card write failed/);
		expect(count('decks')).toBe(0);
		expect(count('cards')).toBe(0);
		expect(count('card_state')).toBe(0);

		handle.sqlite.exec('drop trigger fail_card');
		expect(commit(makeDeck(abc())).counts.new).toBe(3);
	});

	it('does not touch an existing deck when an update fails midway', () => {
		commit(makeDeck(abc()));
		const before = dump();
		handle.sqlite.exec(
			"create trigger fail_update before update on cards when new.key = 'c' begin select raise(abort, 'update failed'); end"
		);
		expect(() =>
			commit(
				makeDeck([
					basic('a', 'Q a', 'changed'),
					basic('b', 'Q b', 'changed'),
					basic('c', 'Q c', 'changed')
				])
			)
		).toThrow(/update failed/);
		expect(dump()).toBe(before);
	});

	it('returns duplicate-key errors and writes nothing', () => {
		const changesBefore = totalChanges();
		const result = commitImport(
			handle.db,
			makeDeck([
				{ type: 'basic', front: 'Same', back: '1' },
				{ type: 'basic', front: 'Same', back: '2' }
			]),
			{ archiveMissing: false, format: 'json' },
			clock
		);
		expect(result.ok).toBe(false);
		expect(totalChanges()).toBe(changesBefore);
		expect(count('decks')).toBe(0);
	});
});

describe('commitImport: warnings', () => {
	it('passes the generated-id warning through to the caller', () => {
		const result = commit(makeDeck([{ type: 'basic', front: 'No id here', back: 'A' }]));
		expect(result.warnings[0]).toMatchObject({ code: 'generated_id' });
	});
});
