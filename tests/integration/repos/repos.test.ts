import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import * as repos from '#lib/server/repos/index.ts';
import { DEFAULT_SETTINGS } from '#lib/core/settings.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;
let handle: DatabaseHandle;
const now = '2026-10-10T12:00:00.000Z';
const later = '2026-10-11T12:00:00.000Z';

beforeEach(() => {
	dir = makeTempDir();
	handle = openDatabase({ dataDir: dir.path, clock: fakeClock(now) });
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

const x = () => handle.db;

function newCard(deckId: string, key: string, position = 0) {
	return {
		deckId,
		key,
		type: 'basic' as const,
		content: { front: `Q ${key}`, back: `A ${key}` },
		contentHash: `hash-${key}`,
		position,
		createdAt: now,
		updatedAt: now
	};
}

function newState(cardPk: number, ordinal = 0) {
	return { cardPk, ordinal, due: now };
}

describe('decks repo', () => {
	it('creates, then updates, a deck and restores an archived one', () => {
		const input = { id: 'ccna', title: 'CCNA', description: undefined, tags: ['net'] };
		expect(repos.upsertDeck(x(), input, now)).toBe('created');
		expect(repos.getDeck(x(), 'ccna')).toMatchObject({
			title: 'CCNA',
			description: null,
			tags: ['net'],
			createdAt: now,
			updatedAt: now
		});

		handle.sqlite.prepare("update decks set archived = 1 where id = 'ccna'").run();
		expect(
			repos.upsertDeck(x(), { ...input, title: 'CCNA 200-301', description: 'exam' }, later)
		).toBe('updated');
		expect(repos.getDeck(x(), 'ccna')).toMatchObject({
			title: 'CCNA 200-301',
			description: 'exam',
			archived: false,
			createdAt: now,
			updatedAt: later
		});
	});

	it('keeps a stored description and tags when an update omits them, and clears them when explicit', () => {
		repos.upsertDeck(x(), { id: 'k', title: 'K', description: 'Keep me', tags: ['a', 'b'] }, now);
		repos.upsertDeck(x(), { id: 'k', title: 'K2', description: undefined, tags: undefined }, later);
		expect(repos.getDeck(x(), 'k')).toMatchObject({
			title: 'K2',
			description: 'Keep me',
			tags: ['a', 'b']
		});

		repos.upsertDeck(x(), { id: 'k', title: 'K2', description: '', tags: [] }, later);
		expect(repos.getDeck(x(), 'k')).toMatchObject({ description: '', tags: [] });
	});

	it('lists decks by title and hides archived ones unless asked', () => {
		repos.upsertDeck(x(), { id: 'b', title: 'Beta', description: undefined, tags: [] }, now);
		repos.upsertDeck(x(), { id: 'a', title: 'Alpha', description: undefined, tags: [] }, now);
		repos.upsertDeck(x(), { id: 'z', title: 'Zeta', description: undefined, tags: [] }, now);
		handle.sqlite.prepare("update decks set archived = 1 where id = 'z'").run();
		expect(repos.listDecks(x()).map((d) => d.id)).toEqual(['a', 'b']);
		expect(repos.listDecks(x(), { includeArchived: true }).map((d) => d.id)).toEqual([
			'a',
			'b',
			'z'
		]);
	});

	it('returns undefined for an unknown deck', () => {
		expect(repos.getDeck(x(), 'nope')).toBeUndefined();
	});
});

describe('cards repo', () => {
	beforeEach(() => {
		repos.upsertDeck(x(), { id: 'd', title: 'D', description: undefined, tags: [] }, now);
	});

	it('inserts, reads by key and pk, and lists in file order including archived cards', () => {
		const second = repos.insertCard(x(), newCard('d', 'second', 1));
		const first = repos.insertCard(x(), newCard('d', 'first', 0));
		repos.setCardsArchived(x(), [second], true, later);

		expect(repos.getCardByKey(x(), 'd', 'first')?.pk).toBe(first);
		expect(repos.getCard(x(), second)).toMatchObject({
			key: 'second',
			archived: true,
			updatedAt: later
		});
		expect(repos.listCardsForDeck(x(), 'd').map((c) => c.key)).toEqual(['first', 'second']);
		expect(repos.getCardByKey(x(), 'd', 'missing')).toBeUndefined();
	});

	it('updates only the fields in the patch', () => {
		const pk = repos.insertCard(x(), newCard('d', 'c1'));
		repos.updateCard(x(), pk, {
			content: { front: 'New Q', back: 'New A' },
			contentHash: 'new-hash',
			tags: ['x'],
			updatedAt: later
		});
		expect(repos.getCard(x(), pk)).toMatchObject({
			content: { front: 'New Q', back: 'New A' },
			contentHash: 'new-hash',
			tags: ['x'],
			position: 0,
			type: 'basic',
			createdAt: now,
			updatedAt: later
		});
	});

	it('does nothing when archiving an empty list', () => {
		expect(() => repos.setCardsArchived(x(), [], true, later)).not.toThrow();
	});

	it('scopes keys to a deck', () => {
		repos.upsertDeck(x(), { id: 'e', title: 'E', description: undefined, tags: [] }, now);
		repos.insertCard(x(), newCard('d', 'shared'));
		repos.insertCard(x(), newCard('e', 'shared'));
		expect(repos.getCardByKey(x(), 'e', 'shared')?.deckId).toBe('e');
	});
});

describe('card state repo', () => {
	let pk: number;
	beforeEach(() => {
		repos.upsertDeck(x(), { id: 'd', title: 'D', description: undefined, tags: [] }, now);
		pk = repos.insertCard(x(), newCard('d', 'c1'));
	});

	it('inserts state rows with defaults and reads them back', () => {
		repos.insertStates(x(), [newState(pk, 1), newState(pk, 2)]);
		expect(repos.getState(x(), pk, 1)).toMatchObject({
			cardPk: pk,
			ordinal: 1,
			due: now,
			stability: 0,
			difficulty: 0,
			reps: 0,
			lapses: 0,
			phase: 0,
			lastReview: null,
			leech: false,
			buriedUntil: null,
			archived: false
		});
		expect(repos.getState(x(), pk, 3)).toBeUndefined();
	});

	it('updates, archives, and deletes state rows', () => {
		repos.insertStates(x(), [newState(pk, 1), newState(pk, 2), newState(pk, 3)]);
		repos.updateState(x(), pk, 1, { phase: 2, stability: 4.5, lapses: 1, lastReview: later });
		expect(repos.getState(x(), pk, 1)).toMatchObject({
			phase: 2,
			stability: 4.5,
			lapses: 1,
			lastReview: later
		});
		expect(repos.getState(x(), pk, 2)?.phase).toBe(0);

		repos.setStatesArchived(x(), pk, [2, 3], true);
		const archived = repos
			.listStatesForCards(x(), [pk])
			.filter((s) => s.archived)
			.map((s) => s.ordinal);
		expect(archived.sort()).toEqual([2, 3]);
		repos.setStatesArchived(x(), pk, [3], false);
		expect(repos.getState(x(), pk, 3)?.archived).toBe(false);

		repos.deleteStatesForCard(x(), pk);
		expect(repos.listStatesForCards(x(), [pk])).toEqual([]);
	});

	it('lists states for a deck, not for other decks', () => {
		repos.upsertDeck(x(), { id: 'e', title: 'E', description: undefined, tags: [] }, now);
		const other = repos.insertCard(x(), newCard('e', 'c9'));
		repos.insertStates(x(), [newState(pk), newState(other)]);
		expect(repos.listStatesForDeck(x(), 'd').map((s) => s.cardPk)).toEqual([pk]);
	});

	it('handles more cards than one chunk of bound variables', () => {
		const pks: number[] = [];
		for (let i = 0; i < 1200; i++) pks.push(repos.insertCard(x(), newCard('d', `bulk-${i}`, i)));
		repos.insertStates(
			x(),
			pks.map((cardPk) => newState(cardPk))
		);
		expect(repos.listStatesForCards(x(), pks)).toHaveLength(1200);
	});

	it('does nothing for empty inputs', () => {
		expect(() => repos.insertStates(x(), [])).not.toThrow();
		expect(repos.listStatesForCards(x(), [])).toEqual([]);
		expect(() => repos.setStatesArchived(x(), pk, [], true)).not.toThrow();
	});
});

describe('review log repo', () => {
	it('appends a row and reads it back by id', () => {
		repos.upsertDeck(x(), { id: 'd', title: 'D', description: undefined, tags: [] }, now);
		const pk = repos.insertCard(x(), newCard('d', 'c1'));
		repos.insertReviewLog(x(), {
			id: '3f1c0a4e-0d6e-4c7a-9b0e-2b1f4a9d7c10',
			cardPk: pk,
			ordinal: 0,
			mode: 'review',
			grade: 3,
			preDue: now,
			preStability: 0,
			preDifficulty: 0,
			preElapsedDays: 0,
			preScheduledDays: 0,
			preLearningSteps: 0,
			preReps: 0,
			preLapses: 0,
			prePhase: 0,
			result: { phase: 1 },
			scheduledDays: 0,
			durationMs: 1800,
			typedAnswer: 'show ip route',
			reviewedAt: now
		});
		const row = repos.getReviewLog(x(), '3f1c0a4e-0d6e-4c7a-9b0e-2b1f4a9d7c10');
		expect(row).toMatchObject({
			mode: 'review',
			grade: 3,
			result: { phase: 1 },
			durationMs: 1800,
			typedAnswer: 'show ip route',
			preLastReview: null
		});
		expect(repos.getReviewLog(x(), 'missing')).toBeUndefined();
	});

	it('rejects a duplicate id, which is how double submits are caught', () => {
		repos.upsertDeck(x(), { id: 'd', title: 'D', description: undefined, tags: [] }, now);
		const pk = repos.insertCard(x(), newCard('d', 'c1'));
		const row = {
			id: 'dup',
			cardPk: pk,
			ordinal: 0,
			mode: 'review' as const,
			grade: 3,
			preDue: now,
			preStability: 0,
			preDifficulty: 0,
			preElapsedDays: 0,
			preScheduledDays: 0,
			preLearningSteps: 0,
			preReps: 0,
			preLapses: 0,
			prePhase: 0,
			reviewedAt: now
		};
		repos.insertReviewLog(x(), row);
		expect(() => repos.insertReviewLog(x(), row)).toThrow(/UNIQUE|PRIMARY/);
	});
});

describe('settings repo', () => {
	it('returns the seeded defaults', () => {
		expect(repos.getSettings(x())).toEqual(DEFAULT_SETTINGS);
		expect(repos.getSetting(x(), 'newPerDay')).toBe(20);
	});

	it('stores valid values and rejects invalid ones without changing anything', () => {
		expect(repos.setSetting(x(), 'targetRetention', 0.85)).toEqual({ ok: true, value: 0.85 });
		expect(repos.getSetting(x(), 'targetRetention')).toBe(0.85);

		const bad = repos.setSetting(x(), 'targetRetention', 2);
		expect(bad.ok).toBe(false);
		expect(repos.setSetting(x(), 'rolloverHour', 24).ok).toBe(false);
		expect(repos.setSetting(x(), 'newPerDay', 1.5).ok).toBe(false);
		expect(repos.setSetting(x(), 'interleave', 'yes').ok).toBe(false);
		expect(repos.getSetting(x(), 'targetRetention')).toBe(0.85);
		expect(repos.getSetting(x(), 'rolloverHour')).toBe(4);
	});

	it('falls back to the default for corrupt, out-of-range, or unknown stored rows', () => {
		const sql = handle.sqlite;
		sql.prepare("update settings set value = 'not json' where key = 'newPerDay'").run();
		sql.prepare("update settings set value = '99' where key = 'targetRetention'").run();
		sql.prepare("insert into settings (key, value) values ('mystery', '1')").run();
		const settings = repos.getSettings(x());
		expect(settings.newPerDay).toBe(20);
		expect(settings.targetRetention).toBe(0.9);
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});

	it('updates an existing key in place', () => {
		repos.setSetting(x(), 'leechThreshold', 5);
		repos.setSetting(x(), 'leechThreshold', 6);
		expect(repos.getSetting(x(), 'leechThreshold')).toBe(6);
		expect(
			(
				handle.sqlite
					.prepare("select count(*) as n from settings where key = 'leechThreshold'")
					.get() as { n: number }
			).n
		).toBe(1);
	});
});

describe('import history repo', () => {
	it('records imports and lists newest first, filtered by deck', () => {
		repos.upsertDeck(x(), { id: 'a', title: 'A', description: undefined, tags: [] }, now);
		repos.upsertDeck(x(), { id: 'b', title: 'B', description: undefined, tags: [] }, now);
		const base = {
			newCount: 1,
			updatedCount: 0,
			unchangedCount: 0,
			archivedCount: 0,
			createdAt: now
		};
		const first = repos.insertImportHistory(x(), {
			...base,
			deckId: 'a',
			format: 'json',
			filename: 'a.json'
		});
		const second = repos.insertImportHistory(x(), {
			...base,
			deckId: 'b',
			format: 'markdown',
			filename: undefined
		});
		const third = repos.insertImportHistory(x(), {
			...base,
			deckId: 'a',
			format: 'json',
			filename: undefined
		});

		expect(repos.listImportHistory(x()).map((r) => r.id)).toEqual([third, second, first]);
		expect(repos.listImportHistory(x(), { deckId: 'a' }).map((r) => r.id)).toEqual([third, first]);
		expect(repos.listImportHistory(x(), { limit: 1 })).toHaveLength(1);
		expect(repos.listImportHistory(x(), { deckId: 'b' })[0]).toMatchObject({
			filename: null,
			format: 'markdown'
		});
	});
});

describe('repos inside a transaction', () => {
	it('accept a transaction as the executor and roll back with it', () => {
		expect(() =>
			handle.db.transaction((tx) => {
				repos.upsertDeck(tx, { id: 't', title: 'T', description: undefined, tags: [] }, now);
				repos.insertCard(tx, newCard('t', 'c1'));
				throw new Error('abort');
			})
		).toThrow('abort');
		expect(repos.getDeck(x(), 't')).toBeUndefined();
	});
});
