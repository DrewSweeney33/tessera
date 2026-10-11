import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataDirError, checkDataDir } from '#lib/server/boot-check.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

let dir: TempDir;

beforeEach(() => {
	dir = makeTempDir();
});

afterEach(() => {
	dir.cleanup();
});

describe('checkDataDir', () => {
	it('creates a missing directory, including parents, and leaves no probe file behind', () => {
		const target = join(dir.path, 'a', 'b', 'data');
		expect(() => checkDataDir(target)).not.toThrow();
		expect(existsSync(target)).toBe(true);
		expect(readdirSync(target)).toEqual([]);
	});

	it('accepts an existing writable directory', () => {
		expect(() => checkDataDir(dir.path)).not.toThrow();
	});

	it('fails with a message that names the path and the fix when the directory cannot be created', () => {
		const blocker = join(dir.path, 'not-a-directory');
		writeFileSync(blocker, 'a file where a directory is needed');
		const target = join(blocker, 'data');

		let error: unknown;
		try {
			checkDataDir(target);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(DataDirError);
		const message = (error as Error).message;
		expect(message).toContain('Cannot write to the data directory');
		expect(message).toContain('not-a-directory');
		expect(message).toMatch(/writable by/);
		expect((error as Error).cause).toBeDefined();
	});
});
