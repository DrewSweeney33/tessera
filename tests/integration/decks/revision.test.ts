import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { cardState, cards, decks, importHistory } from '#lib/server/db/schema.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { deckRevision } from '#lib/server/decks/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The revision of a deck (ADR-013): a fingerprint of everything an editor shows, so a save made from an old
// copy can be refused. A deck's updatedAt cannot do this job, because it changes only when the title, the
// description, or the tags change and not when a card does.

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

function commit(deck: ReturnType<typeof makeDeck>, archiveMissing = false): void {
	clock.advance(1000);
	const result = commitImport(handle.db, deck, { archiveMissing, format: 'json' }, clock);
	if (!result.ok) throw new Error(`commit failed: ${JSON.stringify(result.error)}`);
}

const base = () => makeDeck([basic('a'), basic('b'), cloze('c', 'The {{c1::DR}}')], { title: 'T' });
const revision = () => deckRevision(handle.db, 'd1');

describe('deckRevision', () => {
	it('is a 64 character fingerprint, and nothing for a deck that does not exist', () => {
		expect(revision()).toBeUndefined();
		commit(base());
		expect(revision()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is the same every time while nothing changes, and after the database is reopened', () => {
		commit(base());
		const first = revision();
		expect(revision()).toBe(first);
		handle.close();
		handle = openDatabase({ dataDir: dir.path, clock });
		expect(revision()).toBe(first);
	});

	it('does not change when the same deck is imported again', () => {
		commit(base());
		const before = revision();
		commit(base());
		commit(base());
		expect(revision()).toBe(before);
	});

	it('changes when the text of a card changes', () => {
		commit(base());
		const before = revision();
		commit(
			makeDeck([basic('a', 'Q a', 'A changed'), basic('b'), cloze('c', 'The {{c1::DR}}')], {
				title: 'T'
			})
		);
		expect(revision()).not.toBe(before);
	});

	it('changes when a card is added, and when one is removed', () => {
		commit(base());
		const before = revision();
		commit(
			makeDeck([basic('a'), basic('b'), cloze('c', 'The {{c1::DR}}'), basic('d')], { title: 'T' })
		);
		const added = revision();
		expect(added).not.toBe(before);
		commit(makeDeck([basic('a'), basic('b'), cloze('c', 'The {{c1::DR}}')], { title: 'T' }), true);
		const removed = revision();
		expect(removed).not.toBe(added);
		expect(removed).not.toBe(before); // the removed card is still there, archived
	});

	it('changes when cards are only put in another order', () => {
		commit(base());
		const before = revision();
		commit(makeDeck([cloze('c', 'The {{c1::DR}}'), basic('a'), basic('b')], { title: 'T' }));
		expect(revision()).not.toBe(before);
	});

	it('changes when two cards with exactly the same text swap their ids', () => {
		commit(
			makeDeck([
				basic('a', 'Same question', 'Same answer'),
				basic('b', 'Same question', 'Same answer')
			])
		);
		const before = revision();
		commit(
			makeDeck([
				basic('b', 'Same question', 'Same answer'),
				basic('a', 'Same question', 'Same answer')
			])
		);
		expect(revision()).not.toBe(before);
	});

	it('changes when the title, the description, or the tags change', () => {
		commit(base());
		const seen = new Set<string | undefined>([revision()]);
		for (const meta of [
			{ title: 'New title' },
			{ title: 'New title', description: 'A description' },
			{ title: 'New title', description: 'A description', tags: ['x'] },
			{ title: 'New title', description: 'A description', tags: ['x', 'y'] }
		]) {
			commit(makeDeck([basic('a'), basic('b'), cloze('c', 'The {{c1::DR}}')], meta));
			seen.add(revision());
		}
		expect(seen.size).toBe(5);
	});

	it('changes when the deck is moved to the Trash, and back', () => {
		commit(base());
		const before = revision();
		handle.db.update(decks).set({ archived: true }).where(eq(decks.id, 'd1')).run();
		expect(revision()).not.toBe(before);
		handle.db.update(decks).set({ archived: false }).where(eq(decks.id, 'd1')).run();
		expect(revision()).toBe(before);
	});

	it('does not change when the deck is studied (the schedule of a card), because an editor does not show that', () => {
		commit(base());
		const before = revision();
		handle.db.update(cardState).set({ stability: 12.5, reps: 3, lapses: 1 }).run();
		expect(revision()).toBe(before);
	});

	it('does not change when only housekeeping rows change', () => {
		commit(base());
		const before = revision();
		handle.db.update(importHistory).set({ filename: 'x.json' }).run();
		handle.db.update(cards).set({ updatedAt: '2030-01-01T00:00:00.000Z' }).run();
		expect(revision()).toBe(before);
	});

	it('keeps decks apart: a change in one deck does not move the revision of another', () => {
		commit(base());
		commit(makeDeck([basic('x')], { id: 'other', title: 'Other' }));
		const before = revision();
		const otherBefore = deckRevision(handle.db, 'other');
		commit(makeDeck([basic('x', 'changed', 'A')], { id: 'other', title: 'Other' }));
		expect(revision()).toBe(before);
		expect(deckRevision(handle.db, 'other')).not.toBe(otherBefore);
	});
});
