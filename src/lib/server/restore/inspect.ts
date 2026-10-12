import { join } from 'node:path';
import { err, ok, type Result } from '#lib/core/result.ts';
import { backupsFolder, listSnapshots, type SnapshotInfo } from '../backups/index.ts';
import { summarizeDatabase, type DataSummary, type InspectProblem } from '../db/inspect.ts';

export { summarizeDatabase };
export type { DataSummary, InspectKind, InspectProblem } from '../db/inspect.ts';

// A backup in the backups folder: it must be a file the Backups list shows, so a name is never a path.
export function inspectBackup(
	dataDir: string,
	name: string,
	migrationsFolder?: string
): Result<{ backup: SnapshotInfo; summary: DataSummary }, InspectProblem> {
	const backup = listSnapshots(dataDir).find((entry) => entry.name === name);
	if (!backup) return err({ kind: 'not_found', message: 'There is no such backup.' });
	const summary = summarizeDatabase(join(backupsFolder(dataDir), backup.name), migrationsFolder);
	return summary.ok ? ok({ backup, summary: summary.value }) : err(summary.error);
}
