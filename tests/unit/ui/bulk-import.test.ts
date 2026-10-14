import { describe, expect, it } from 'vitest';
import type { ImportCountsDto, ImportPlanSummary } from '#lib/core/api-types.ts';
import {
	dedupeFiles,
	findDuplicateDeckIds,
	isDeckFile,
	tallyBatch,
	type BulkItem
} from '#lib/ui/bulk-import.ts';

const counts = (over: Partial<ImportCountsDto> = {}): ImportCountsDto => ({
	new: 0,
	updated: 0,
	typeChanged: 0,
	restored: 0,
	unchanged: 0,
	absent: 0,
	archivedMissing: 0,
	...over
});

const plan = (deckId: string, over: Partial<ImportCountsDto> = {}): ImportPlanSummary => ({
	deck: { id: deckId, title: deckId, action: 'created', changed: true },
	counts: counts(over),
	cards: [],
	absent: [],
	archiveMissing: false,
	warnings: []
});

const item = (id: number, name: string, over: Partial<BulkItem> = {}): BulkItem => ({
	id,
	name,
	text: '{}',
	format: 'json',
	status: 'queued',
	errors: [],
	...over
});

describe('isDeckFile', () => {
	it('accepts the deck file types, in any case', () => {
		for (const name of ['a.json', 'a.md', 'a.markdown', 'a.txt', 'DECK.JSON', 'x.y.Md']) {
			expect(isDeckFile({ name })).toBe(true);
		}
	});

	it('refuses everything else', () => {
		for (const name of ['a.png', 'a.json.exe', 'json', 'a.md.bak', 'notes']) {
			expect(isDeckFile({ name })).toBe(false);
		}
	});
});

describe('dedupeFiles', () => {
	it('lists a file picked twice once, and keeps files that only share a name', () => {
		const a = new File(['one'], 'a.json', { lastModified: 1 });
		const aAgain = new File(['one'], 'a.json', { lastModified: 1 });
		const aEdited = new File(['one two'], 'a.json', { lastModified: 2 });
		expect(dedupeFiles([a, aAgain, aEdited])).toEqual([a, aEdited]);
	});
});

describe('findDuplicateDeckIds', () => {
	it('marks only the later file that repeats a deck id', () => {
		const items = [
			item(1, 'first.json', { plan: plan('ospf'), status: 'ready' }),
			item(2, 'other.json', { plan: plan('tcp'), status: 'ready' }),
			item(3, 'copy.json', { plan: plan('ospf'), status: 'ready' })
		];
		const found = findDuplicateDeckIds(items);
		expect([...found.keys()]).toEqual([3]);
		expect(found.get(3)).toContain('first.json');
	});

	it('ignores files that have no preview yet', () => {
		expect(findDuplicateDeckIds([item(1, 'a.json'), item(2, 'b.json')]).size).toBe(0);
	});
});

describe('tallyBatch', () => {
	it('counts files by status and adds up cards for the decks that will import', () => {
		const tally = tallyBatch([
			item(1, 'a.json', { status: 'ready', plan: plan('a', { new: 3, unchanged: 1 }) }),
			item(2, 'b.json', {
				status: 'ready',
				plan: plan('b', { new: 1, updated: 2, typeChanged: 1, restored: 1 })
			}),
			item(3, 'c.json', { status: 'problem', plan: plan('c', { new: 99 }) }),
			item(4, 'd.json', { status: 'queued' }),
			item(5, 'e.json', { status: 'unchanged' })
		]);
		expect(tally).toMatchObject({
			total: 5,
			ready: 2,
			problems: 1,
			waiting: 1,
			unchanged: 1,
			cards: { new: 4, updated: 4, unchanged: 1 }
		});
	});

	it('prefers what was imported over what was previewed', () => {
		const tally = tallyBatch([
			item(1, 'a.json', {
				status: 'imported',
				plan: plan('a', { new: 5 }),
				result: {
					deckId: 'a',
					changed: true,
					counts: counts({ new: 4 }),
					warnings: [],
					importHistoryId: 1
				}
			})
		]);
		expect(tally.imported).toBe(1);
		expect(tally.cards.new).toBe(4);
	});
});
