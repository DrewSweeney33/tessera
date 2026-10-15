import { folderNameProblem, tidyFolderName } from '#lib/core/folder.ts';
import { err, ok, type Result } from '#lib/core/result.ts';
import type { Db } from '../db/client.ts';
import type { FolderRow } from '../db/schema.ts';
import { withTx } from '../db/tx.ts';
import {
	countDecksByFolder,
	deleteFolderRow,
	findFolderByName,
	getDeck,
	getFolder,
	insertFolder,
	renameFolderRow,
	setDecksFolder
} from '../repos/index.ts';

// Project folders (folders group decks on the decks screen and scope a study session). A deck is in at most one
// folder and folders do not nest. A folder is only a label: making, renaming, or deleting one never changes a deck's
// cards, schedule, or history, and deck import and export do not know about folders.

export type FolderProblem =
	| { kind: 'invalid_name'; code: string; message: string }
	| { kind: 'name_taken'; message: string }
	| { kind: 'not_found' };

function checkName(name: string): FolderProblem | undefined {
	const problem = folderNameProblem(name);
	return problem
		? { kind: 'invalid_name', code: problem.code, message: problem.message }
		: undefined;
}

function nameTaken(name: string): FolderProblem {
	return {
		kind: 'name_taken',
		message: `There is already a folder called "${name}". Pick another name.`
	};
}

export function createFolder(db: Db, name: string, now: string): Result<FolderRow, FolderProblem> {
	const bad = checkName(name);
	if (bad) return err(bad);
	const tidy = tidyFolderName(name);
	return withTx(db, (tx) => {
		if (findFolderByName(tx, tidy)) return err(nameTaken(tidy));
		return ok(insertFolder(tx, tidy, now));
	});
}

// Renaming a folder to the same name with different letter case is allowed, so a folder's capitals can be fixed.
export function renameFolder(
	db: Db,
	id: number,
	name: string,
	now: string
): Result<FolderRow, FolderProblem> {
	const bad = checkName(name);
	if (bad) return err(bad);
	const tidy = tidyFolderName(name);
	return withTx(db, (tx) => {
		const folder = getFolder(tx, id);
		if (!folder) return err({ kind: 'not_found' as const });
		const same = findFolderByName(tx, tidy);
		if (same && same.id !== id) return err(nameTaken(tidy));
		renameFolderRow(tx, id, tidy, now);
		return ok({ ...folder, name: tidy, updatedAt: now });
	});
}

export interface DeletedFolder {
	id: number;
	name: string;
	// Decks that were in it and are ungrouped now.
	decks: number;
}

// Deletes the folder. Its decks go back to the ungrouped list; no deck, card, or review is deleted. A folder that
// is already gone is not found (the screen reloads and the folder is not there).
export function deleteFolder(db: Db, id: number): Result<DeletedFolder, { kind: 'not_found' }> {
	return withTx(db, (tx) => {
		const folder = getFolder(tx, id);
		if (!folder) return err({ kind: 'not_found' as const });
		const decks = countDecksByFolder(tx).get(id) ?? 0;
		deleteFolderRow(tx, id);
		return ok({ id, name: folder.name, decks });
	});
}

export type AssignProblem =
	{ kind: 'folder_not_found' } | { kind: 'deck_not_found'; deckId: string };

// Puts decks in a folder, or takes them out of any folder (`folderId` null). Every deck must be in the deck list
// (a deck in the Trash is not), or nothing changes.
export function assignDecks(
	db: Db,
	deckIds: string[],
	folderId: number | null
): Result<{ moved: number }, AssignProblem> {
	return withTx(db, (tx) => {
		if (folderId !== null && !getFolder(tx, folderId))
			return err({ kind: 'folder_not_found' as const });
		const unique = [...new Set(deckIds)];
		for (const deckId of unique) {
			const deck = getDeck(tx, deckId);
			if (!deck || deck.archived) return err({ kind: 'deck_not_found' as const, deckId });
		}
		return ok({ moved: setDecksFolder(tx, unique, folderId) });
	});
}
