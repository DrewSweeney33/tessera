import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { err, ok, type Result } from '#lib/core/result.ts';
import { newestKnownMigration } from './migrate.ts';

// Looking at a database file before it is trusted: is it a database, is it whole, is it Tessera's, and does this
// version understand it? Read only. Used to show what a restore would bring back, and again at the restart that
// applies it.

export interface DataSummary {
	decks: number;
	cards: number;
	reviews: number;
	// The time of the most recent review, if there is one.
	newestReviewAt: string | null;
}

export type InspectKind = 'not_found' | 'not_a_database' | 'damaged' | 'not_tessera' | 'too_new';

export interface InspectProblem {
	kind: InspectKind;
	message: string;
}

const SQLITE_HEADER = 'SQLite format 3\u0000';
const REQUIRED_TABLES = ['decks', 'cards', 'card_state', 'review_log', '__drizzle_migrations'];

function hasSqliteHeader(path: string): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(path, 'r');
		const buffer = Buffer.alloc(16);
		const read = readSync(fd, buffer, 0, 16, 0);
		return read === 16 && buffer.toString('latin1') === SQLITE_HEADER;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

// What a database file holds, or the reason it cannot be restored. `migrationsFolder` is where this version's
// migration journal is, so a database from a newer version can be told from one from an older version.
export function summarizeDatabase(
	path: string,
	migrationsFolder: string = resolve('drizzle')
): Result<DataSummary, InspectProblem> {
	if (!hasSqliteHeader(path)) {
		return err({ kind: 'not_a_database', message: 'This file is not a SQLite database.' });
	}
	let db: Database.Database | undefined;
	try {
		db = new Database(path, { readonly: true, fileMustExist: true });
		const integrity = db.pragma('integrity_check', { simple: true });
		if (integrity !== 'ok') {
			return err({
				kind: 'damaged',
				message: 'This database is damaged (its integrity check failed).'
			});
		}
		const tables = new Set(
			(
				db.prepare("select name from sqlite_master where type = 'table'").all() as {
					name: string;
				}[]
			).map((row) => row.name)
		);
		if (!REQUIRED_TABLES.every((table) => tables.has(table))) {
			return err({ kind: 'not_tessera', message: 'This is not a Tessera database.' });
		}
		const applied =
			(
				db.prepare('select max(created_at) as latest from __drizzle_migrations').get() as {
					latest: number | null;
				}
			).latest ?? 0;
		if (applied > newestKnownMigration(migrationsFolder)) {
			return err({
				kind: 'too_new',
				message:
					'This database was written by a newer version of Tessera than the one running now, so it cannot be restored here.'
			});
		}
		const handle = db;
		const count = (table: string) =>
			(handle.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
		const newest = db.prepare('select max(reviewed_at) as at from review_log').get() as {
			at: string | null;
		};
		return ok({
			decks: count('decks'),
			cards: count('cards'),
			reviews: count('review_log'),
			newestReviewAt: newest.at
		});
	} catch {
		// SQLite refuses to read a file whose pages do not make sense, for example "database disk image is
		// malformed". All of those mean the same to the owner.
		return err({ kind: 'damaged', message: 'This database is damaged and cannot be read.' });
	} finally {
		db?.close();
	}
}
