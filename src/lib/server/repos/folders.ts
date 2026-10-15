import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { decks, folders, type FolderRow } from '../db/schema.ts';

// Folders group decks on the decks screen (project folders). A deck is in at most one folder; deleting a folder
// ungroups its decks (the foreign key sets decks.folder_id to null) and touches nothing else.

export function listFolders(x: Executor): FolderRow[] {
	return x
		.select()
		.from(folders)
		.orderBy(sql`lower(${folders.name})`, asc(folders.id))
		.all();
}

export function getFolder(x: Executor, id: number): FolderRow | undefined {
	return x.select().from(folders).where(eq(folders.id, id)).get();
}

// A folder with this name, ignoring case (SQLite folds ASCII only, the same as the unique index).
export function findFolderByName(x: Executor, name: string): FolderRow | undefined {
	return x
		.select()
		.from(folders)
		.where(sql`lower(${folders.name}) = lower(${name})`)
		.get();
}

export function insertFolder(x: Executor, name: string, now: string): FolderRow {
	return x.insert(folders).values({ name, createdAt: now, updatedAt: now }).returning().get();
}

export function renameFolderRow(x: Executor, id: number, name: string, now: string): void {
	x.update(folders).set({ name, updatedAt: now }).where(eq(folders.id, id)).run();
}

export function deleteFolderRow(x: Executor, id: number): void {
	x.delete(folders).where(eq(folders.id, id)).run();
}

// Puts decks in a folder, or takes them out of any folder when `folderId` is null. Returns how many decks changed.
export function setDecksFolder(x: Executor, deckIds: string[], folderId: number | null): number {
	if (deckIds.length === 0) return 0;
	return x.update(decks).set({ folderId }).where(inArray(decks.id, deckIds)).run().changes;
}

// Decks in the deck list (not the Trash) per folder.
export function countDecksByFolder(x: Executor): Map<number, number> {
	const rows = x
		.select({ folderId: decks.folderId, total: count() })
		.from(decks)
		.where(eq(decks.archived, false))
		.groupBy(decks.folderId)
		.all();
	const out = new Map<number, number>();
	for (const row of rows) if (row.folderId !== null) out.set(row.folderId, row.total);
	return out;
}
