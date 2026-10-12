import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, type Result } from '#lib/core/result.ts';
import type { Clock } from '../clock.ts';
import { inspectBackup, type InspectProblem } from './inspect.ts';

// Staging a restore (ADR-014). The server never swaps a database it has open. It writes a small marker file that
// names the backup and the name the current database will be kept under, and then stops. The next start applies the
// marker (apply.ts) before the database is opened.

export const PENDING_FILE = 'restore-pending.json';
export const RESULT_FILE = 'restore-result.json';

export interface PendingRestore {
	// The backup to restore, a file in the backups folder.
	name: string;
	// What the current database is kept as, a file in the data folder beside it.
	oldName: string;
	stagedAt: string;
}

export interface RestoreResult {
	ok: boolean;
	name: string;
	at: string;
	message: string;
	// For a restore that happened: where the data from before it is kept.
	keptAs?: string;
}

export type StageProblem = InspectProblem | { kind: 'already_pending'; message: string };

export function writeJsonAtomic(path: string, value: unknown): void {
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(temporary, path);
}

export function hasPendingRestore(dataDir: string): boolean {
	return existsSync(join(dataDir, PENDING_FILE));
}

// The restore waiting for the next start, if there is one and its marker can be read.
export function readPendingRestore(dataDir: string): PendingRestore | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(dataDir, PENDING_FILE), 'utf8')) as PendingRestore;
		return typeof parsed.name === 'string' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// What happened at the last restart that had a restore to apply, if there was one.
export function readLastRestore(dataDir: string): RestoreResult | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(dataDir, RESULT_FILE), 'utf8')) as RestoreResult;
		return typeof parsed.ok === 'boolean' && typeof parsed.name === 'string' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// Checks that the backup can be restored, and writes the marker. Nothing about the data changes yet.
export function stageRestore(
	dataDir: string,
	name: string,
	clock: Clock,
	migrationsFolder?: string
): Result<PendingRestore, StageProblem> {
	if (hasPendingRestore(dataDir)) {
		return err({
			kind: 'already_pending',
			message: 'A restore is already waiting for Tessera to restart.'
		});
	}
	const inspected = inspectBackup(dataDir, name, migrationsFolder);
	if (!inspected.ok) return err(inspected.error);

	const stamp = clock.now().toISOString().replace(/[:.]/g, '-');
	let oldName = `tessera.db.before-restore-${stamp}`;
	for (let n = 1; existsSync(join(dataDir, oldName)); n++) {
		oldName = `tessera.db.before-restore-${stamp}-${n}`;
	}
	const pending: PendingRestore = { name, oldName, stagedAt: clock.now().toISOString() };
	writeJsonAtomic(join(dataDir, PENDING_FILE), pending);
	return ok(pending);
}
