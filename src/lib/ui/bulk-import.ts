import type { FieldErrorDto, ImportCommitDto, ImportPlanSummary } from '#lib/core/api-types.ts';
import type { DeckFormat } from '#lib/core/parse/detect.ts';

// Importing several deck files at once. The server takes one deck per request, so a batch is a list of files
// that are previewed and imported one after another, each reported on its own line.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const DECK_EXTENSION = /\.(json|md|markdown|txt)$/i;

export type BulkStatus =
	'queued' | 'previewing' | 'ready' | 'importing' | 'imported' | 'unchanged' | 'problem';

export interface BulkItem {
	id: number;
	name: string;
	text: string;
	format: DeckFormat;
	status: BulkStatus;
	plan?: ImportPlanSummary | undefined;
	result?: ImportCommitDto | undefined;
	errors: FieldErrorDto[];
	// A problem that is not about the deck's contents: too large, a duplicate id, the server unreachable.
	message?: string | undefined;
	// Set when the problem is only that an earlier file in the batch has the same deck id.
	duplicate?: boolean;
}

export const isDeckFile = (file: { name: string }): boolean => DECK_EXTENSION.test(file.name);

// Newest-last, and a file picked twice is listed once.
export function dedupeFiles(files: File[]): File[] {
	const seen = new Set<string>();
	return files.filter((file) => {
		const key = `${file.name}\n${file.size}\n${file.lastModified}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Two files that carry the same deck id would import over each other, the second silently replacing the first.
// The later file is marked, and only the first of each id goes ahead.
export function findDuplicateDeckIds(items: BulkItem[]): Map<number, string> {
	const firstOfId = new Map<string, BulkItem>();
	const duplicates = new Map<number, string>();
	for (const item of items) {
		const id = item.plan?.deck.id;
		if (id === undefined) continue;
		const first = firstOfId.get(id);
		if (first) {
			duplicates.set(
				item.id,
				`Deck id "${id}" is already used by ${first.name} in this batch. Give one of them its own id.`
			);
		} else {
			firstOfId.set(id, item);
		}
	}
	return duplicates;
}

export interface BulkTally {
	total: number;
	ready: number;
	problems: number;
	imported: number;
	unchanged: number;
	// Not yet previewed.
	waiting: number;
	cards: { new: number; updated: number; unchanged: number };
}

export function tallyBatch(items: BulkItem[]): BulkTally {
	const tally: BulkTally = {
		total: items.length,
		ready: 0,
		problems: 0,
		imported: 0,
		unchanged: 0,
		waiting: 0,
		cards: { new: 0, updated: 0, unchanged: 0 }
	};
	for (const item of items) {
		if (item.status === 'ready') tally.ready++;
		else if (item.status === 'problem') tally.problems++;
		else if (item.status === 'imported') tally.imported++;
		else if (item.status === 'unchanged') tally.unchanged++;
		else tally.waiting++;

		const counts = item.result?.counts ?? item.plan?.counts;
		if (counts && item.status !== 'problem') {
			tally.cards.new += counts.new;
			tally.cards.updated += counts.updated + counts.typeChanged + counts.restored;
			tally.cards.unchanged += counts.unchanged;
		}
	}
	return tally;
}
