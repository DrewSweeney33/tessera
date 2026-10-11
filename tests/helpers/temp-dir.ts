import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempDir {
	path: string;
	cleanup(): void;
}

// A fresh directory per test. Close database handles before cleanup: Windows will not delete open files.
export function makeTempDir(prefix = 'tessera-test-'): TempDir {
	const path = mkdtempSync(join(tmpdir(), prefix));
	return {
		path,
		cleanup: () => rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
	};
}
