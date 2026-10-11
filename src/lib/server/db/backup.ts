import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Sqlite } from './client.ts';

// Writes a consistent, compacted snapshot of the live database to destPath.
// Safe while the app is running, unlike copying the file (WAL changes may be in a side file).
export function backupTo(sqlite: Sqlite, destPath: string): void {
	if (existsSync(destPath)) {
		throw new Error(`Refusing to overwrite existing backup file: ${destPath}`);
	}
	mkdirSync(dirname(destPath), { recursive: true });
	sqlite.prepare('VACUUM INTO ?').run(destPath);
}
