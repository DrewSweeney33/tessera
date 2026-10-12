import {
	closeSync,
	copyFileSync,
	existsSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync
} from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../clock.ts';
import { backupsFolder, isSafeBackupName } from '../backups/index.ts';
import { inspectBackup } from './inspect.ts';
import { PENDING_FILE, RESULT_FILE, writeJsonAtomic, type RestoreResult } from './stage.ts';

// Applying a staged restore, at start, before the database is opened (ADR-014). The steps are ordered so that a
// crash at any point leaves either the old database or the whole backup, and the next start finishes the job:
//
//   1. copy the backup next to the database as tessera.db.restoring, and flush it to disk
//   2. move the current database to its "before restore" name (a rename)
//   3. move the copy into place as tessera.db (a rename)
//   4. remove the old write-ahead files, which belong to the old database, and the marker
//
// The "before restore" name is chosen when the restore is staged and is never reused, so on a restart its
// presence says step 2 has happened, and its absence says it has not.

export type ApplyStep = 'copied' | 'moved-aside' | 'installed' | 'cleaned';

export interface ApplyHooks {
	// Called after each step. Only tests use it, to stop the process at that point.
	after?: (step: ApplyStep) => void;
}

const OLD_NAME = /^tessera\.db\.before-restore-[A-Za-z0-9._-]{1,60}$/;

function flush(path: string): void {
	const fd = openSync(path, 'r+');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

// Applies the restore the marker names, if there is a marker. Returns what happened, or undefined when nothing was
// staged. A restore that cannot be done leaves the database as it was, and says why.
export function applyPendingRestore(
	dataDir: string,
	clock: Clock,
	hooks: ApplyHooks = {},
	migrationsFolder?: string
): RestoreResult | undefined {
	const markerPath = join(dataDir, PENDING_FILE);
	if (!existsSync(markerPath)) return undefined;

	const database = join(dataDir, 'tessera.db');
	const copy = `${database}.restoring`;
	const at = () => clock.now().toISOString();
	const finish = (result: RestoreResult): RestoreResult => {
		writeJsonAtomic(join(dataDir, RESULT_FILE), result);
		rmSync(markerPath, { force: true });
		return result;
	};

	let marker: { name?: unknown; oldName?: unknown };
	try {
		marker = JSON.parse(readFileSync(markerPath, 'utf8')) as typeof marker;
	} catch {
		return finish({
			ok: false,
			name: '',
			at: at(),
			message: 'The restore could not be read, so it was not done. The data was not changed.'
		});
	}
	const name = typeof marker?.name === 'string' ? marker.name : '';
	const oldName = typeof marker?.oldName === 'string' ? marker.oldName : '';
	if (!isSafeBackupName(name) || !OLD_NAME.test(oldName)) {
		return finish({
			ok: false,
			name: '',
			at: at(),
			message:
				'The restore named something that is not a backup, so it was not done. The data was not changed.'
		});
	}
	const aside = join(dataDir, oldName);
	const source = join(backupsFolder(dataDir), name);

	// The restore cannot go on: put things back if an earlier attempt had already moved the database aside.
	const abandon = (message: string): RestoreResult => {
		rmSync(copy, { force: true });
		if (!existsSync(database) && existsSync(aside)) renameSync(aside, database);
		return finish({ ok: false, name, at: at(), message });
	};
	const makeCopy = (): RestoreResult | undefined => {
		const inspected = inspectBackup(dataDir, name, migrationsFolder);
		if (!inspected.ok) return abandon(`${inspected.error.message} The data was not changed.`);
		copyFileSync(source, copy);
		flush(copy);
		return undefined;
	};

	// Steps 1 and 2, unless an earlier attempt already moved the database aside.
	if (!existsSync(aside)) {
		const failed = makeCopy();
		if (failed) return failed;
		hooks.after?.('copied');
		if (existsSync(database)) renameSync(database, aside);
		hooks.after?.('moved-aside');
	}

	// Step 3.
	if (!existsSync(database)) {
		// Only if the copy was lost after the database was moved aside: make it again.
		if (!existsSync(copy)) {
			const failed = makeCopy();
			if (failed) return failed;
		}
		renameSync(copy, database);
		hooks.after?.('installed');
	} else {
		rmSync(copy, { force: true });
	}

	// Step 4. The old write-ahead files would be read as part of the restored database.
	rmSync(`${database}-wal`, { force: true });
	rmSync(`${database}-shm`, { force: true });
	hooks.after?.('cleaned');

	return finish({
		ok: true,
		name,
		at: at(),
		message: `Restored from ${name}. The data from before is kept as ${oldName} in the data folder.`,
		keptAs: oldName
	});
}
