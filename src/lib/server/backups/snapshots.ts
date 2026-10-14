import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { Clock } from '../clock.ts';
import type { Sqlite } from '../db/client.ts';
import { backupTo } from '../db/backup.ts';

// Snapshots (ADR-014): a consistent copy of the database in <dataDir>/backups, taken on demand and before
// anything destructive (ADR-013). The folder already holds the copy that an upgrade makes first.

export type SnapshotKind = 'manual' | 'pre-migrate' | 'pre-delete' | 'pre-reset' | 'pre-restore';
export type ListedKind = SnapshotKind | 'other';

const KINDS: SnapshotKind[] = ['manual', 'pre-migrate', 'pre-delete', 'pre-reset', 'pre-restore'];

// A backup name is a plain file name and never a path: letters, digits, dot, underscore, and hyphen, starting
// with a letter or digit, ending in .db, at most 120 characters. Anything else is not a backup this code names,
// lists, serves, or deletes. The live database file is never one.
export const BACKUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,116}\.db$/;
const LIVE_FILES = new Set(['tessera.db']);

export function isSafeBackupName(name: string): boolean {
	return BACKUP_NAME_PATTERN.test(name) && !name.includes('..') && !LIVE_FILES.has(name);
}

export function snapshotKindOf(name: string): ListedKind {
	for (const kind of KINDS) if (name.startsWith(`${kind}-`)) return kind;
	return 'other';
}

export interface SnapshotInfo {
	name: string;
	kind: ListedKind;
	size: number;
	// When the file was last written, as an ISO time.
	modifiedAt: string;
}

export function backupsFolder(dataDir: string): string {
	return join(dataDir, 'backups');
}

type Write = (sqlite: Sqlite, path: string) => void;

function uniquePath(
	dataDir: string,
	kind: SnapshotKind,
	subject: string | undefined,
	clock: Clock
) {
	const stamp = clock.now().toISOString().replace(/[:.]/g, '-');
	const base = `${kind}${subject === undefined ? '' : `-${subject}`}-${stamp}`;
	let name = `${base}.db`;
	for (let n = 1; existsSync(join(backupsFolder(dataDir), name)); n++) name = `${base}-${n}.db`;
	return { name, path: join(backupsFolder(dataDir), name) };
}

// Writes a snapshot and says what it is. The subject, when there is one, is a deck id: only text that passes the
// deck id rules can end up in a file name. If writing fails (a full disk, say), nothing half-written is left
// behind and the error goes to the caller unchanged, so the API can answer it plainly.
export function createSnapshot(
	sqlite: Sqlite,
	dataDir: string,
	kind: SnapshotKind,
	clock: Clock,
	subject?: string,
	write: Write = backupTo
): SnapshotInfo {
	if (subject !== undefined && !ID_PATTERN.test(subject)) {
		throw new Error('A snapshot subject must be a deck id.');
	}
	const { name, path } = uniquePath(dataDir, kind, subject, clock);
	try {
		write(sqlite, path);
	} catch (error) {
		rmSync(path, { force: true });
		throw error;
	}
	const stats = statSync(path);
	return { name, kind, size: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export interface WithSnapshotOptions {
	kind: SnapshotKind;
	subject?: string;
	clock: Clock;
	// How the copy is written. Only tests replace it.
	write?: Write;
}

// Takes a snapshot, and only then runs the action. If the snapshot cannot be written the action does not run:
// no snapshot, no action (ADR-013). An error from the action leaves the snapshot where it is.
export function withSnapshot<T>(
	sqlite: Sqlite,
	dataDir: string,
	options: WithSnapshotOptions,
	action: () => T
): { snapshot: SnapshotInfo; value: T } {
	const snapshot = createSnapshot(
		sqlite,
		dataDir,
		options.kind,
		options.clock,
		options.subject,
		options.write
	);
	return { snapshot, value: action() };
}

// Every backup in the folder, newest first. Folders, files that are not database files, hidden files, and names
// that would not be served are left out. A missing folder is an empty list.
export function listSnapshots(dataDir: string): SnapshotInfo[] {
	let entries;
	try {
		entries = readdirSync(backupsFolder(dataDir), { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && isSafeBackupName(entry.name))
		.map((entry) => {
			const stats = statSync(join(backupsFolder(dataDir), entry.name));
			return {
				name: entry.name,
				kind: snapshotKindOf(entry.name),
				size: stats.size,
				modifiedAt: stats.mtime.toISOString()
			};
		})
		.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name));
}

// The listed backup with this name, if there is one. Looking a name up in the listing, rather than building a path
// from it, is what keeps a name from ever being a path.
export function findSnapshot(dataDir: string, name: string): SnapshotInfo | undefined {
	return listSnapshots(dataDir).find((entry) => entry.name === name);
}
