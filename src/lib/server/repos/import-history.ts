import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { importHistory, type ImportHistoryRow } from '../db/schema.ts';

export interface ImportHistoryInput {
	deckId: string;
	format: 'json' | 'markdown';
	filename: string | undefined;
	newCount: number;
	updatedCount: number;
	unchangedCount: number;
	archivedCount: number;
	createdAt: string;
}

export function insertImportHistory(x: Executor, input: ImportHistoryInput): number {
	return x
		.insert(importHistory)
		.values({ ...input, filename: input.filename ?? null })
		.returning({ id: importHistory.id })
		.get().id;
}

export function listImportHistory(
	x: Executor,
	options: { deckId?: string; limit?: number } = {}
): ImportHistoryRow[] {
	const query = x.select().from(importHistory);
	const filtered = options.deckId ? query.where(eq(importHistory.deckId, options.deckId)) : query;
	return filtered
		.orderBy(desc(importHistory.id))
		.limit(options.limit ?? 50)
		.all();
}
