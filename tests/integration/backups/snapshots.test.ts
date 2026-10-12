import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type DatabaseHandle } from '#lib/server/db/index.ts';
import { commitImport } from '#lib/server/import/index.ts';
import {
	BACKUP_NAME_PATTERN,
	createSnapshot,
	isSafeBackupName,
	listSnapshots,
	snapshotKindOf,
	withSnapshot
} from '#lib/server/backups/index.ts';
import { toErrorResponse } from '#lib/server/http/errors.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock, type FakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Snapshots (ADR-014): a named copy of the database in <dataDir>/backups, taken before anything destructive
// (ADR-013) and on demand. The rule that matters most: if the snapshot cannot be written, the action does not run.

let dir: TempDir;
let handle: DatabaseHandle;
let clock: FakeClock;

beforeEach(() => {
	dir = makeTempDir();
	clock = fakeClock('2026-10-12T12:00:00.000Z');
	handle = openDatabase({ dataDir: dir.path, clock });
	const result = commitImport(
		handle.db,
		makeDeck([basic('a'), basic('b')]),
		{ archiveMissing: false, format: 'json' },
		clock
	);
	if (!result.ok) throw new Error('setup import failed');
});

afterEach(() => {
	handle.close();
	dir.cleanup();
});

const backups = () => join(dir.path, 'backups');

describe('createSnapshot', () => {
	it('writes a sound copy of the database into the backups folder', () => {
		const info = createSnapshot(handle.sqlite, dir.path, 'manual', clock);
		expect(info.kind).toBe('manual');
		expect(info.name).toMatch(/^manual-2026-10-12T12-00-00-000Z\.db$/);
		expect(info.size).toBeGreaterThan(0);
		expect(existsSync(join(backups(), info.name))).toBe(true);

		const copy = new Database(join(backups(), info.name), { readonly: true });
		try {
			expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
			expect((copy.prepare('select count(*) as n from cards').get() as { n: number }).n).toBe(2);
		} finally {
			copy.close();
		}
	});

	it('leaves the live database as it was', () => {
		const before = handle.sqlite.prepare('select count(*) as n from cards').get();
		createSnapshot(handle.sqlite, dir.path, 'manual', clock);
		expect(handle.sqlite.prepare('select count(*) as n from cards').get()).toEqual(before);
	});

	it('names a snapshot by what it was taken for, with the deck in the name when there is one', () => {
		expect(createSnapshot(handle.sqlite, dir.path, 'pre-delete', clock, 'my-deck').name).toMatch(
			/^pre-delete-my-deck-2026-10-12T12-00-00-000Z\.db$/
		);
		expect(createSnapshot(handle.sqlite, dir.path, 'pre-reset', clock, 'my-deck').name).toMatch(
			/^pre-reset-my-deck-/
		);
		expect(createSnapshot(handle.sqlite, dir.path, 'pre-restore', clock).name).toMatch(
			/^pre-restore-2026/
		);
	});

	it('never reuses a name, even twice in the same millisecond, and never overwrites', () => {
		const names = new Set<string>();
		for (let i = 0; i < 5; i++) {
			names.add(createSnapshot(handle.sqlite, dir.path, 'manual', clock).name);
		}
		expect(names.size).toBe(5);
		expect([...names].every((name) => BACKUP_NAME_PATTERN.test(name))).toBe(true);
	});

	it('makes the folder when it is not there', () => {
		rmSync(backups(), { recursive: true, force: true });
		const info = createSnapshot(handle.sqlite, dir.path, 'manual', clock);
		expect(existsSync(join(backups(), info.name))).toBe(true);
	});

	it('refuses a subject that is not a deck id, so a name can never carry a path', () => {
		for (const subject of ['../x', 'a/b', 'A B', '', 'x'.repeat(65), 'a\\b', 'a.b']) {
			expect(() => createSnapshot(handle.sqlite, dir.path, 'pre-delete', clock, subject)).toThrow();
		}
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('keeps every name inside the length the routes accept, for the longest deck id', () => {
		const info = createSnapshot(handle.sqlite, dir.path, 'pre-restore', clock, 'a'.repeat(64));
		expect(info.name.length).toBeLessThanOrEqual(120);
		expect(BACKUP_NAME_PATTERN.test(info.name)).toBe(true);
	});
});

describe('listSnapshots', () => {
	it('lists what is there, newest first, with kind, size, and time', () => {
		const a = createSnapshot(handle.sqlite, dir.path, 'manual', clock);
		clock.advance(1000);
		const b = createSnapshot(handle.sqlite, dir.path, 'pre-delete', clock, 'my-deck');
		utimesSync(
			join(backups(), a.name),
			new Date('2026-10-12T12:00:00Z'),
			new Date('2026-10-12T12:00:00Z')
		);
		utimesSync(
			join(backups(), b.name),
			new Date('2026-10-12T12:00:01Z'),
			new Date('2026-10-12T12:00:01Z')
		);
		const list = listSnapshots(dir.path);
		expect(list.map((item) => item.name)).toEqual([b.name, a.name]);
		expect(list.map((item) => item.kind)).toEqual(['pre-delete', 'manual']);
		expect(list[0]!.size).toBe(statSync(join(backups(), b.name)).size);
		expect(list[0]!.modifiedAt).toBe('2026-10-12T12:00:01.000Z');
	});

	it('includes the snapshots that upgrades make, and tells an unknown database file from them', () => {
		mkdirSync(backups(), { recursive: true });
		writeFileSync(join(backups(), 'pre-migrate-2026-10-01T00-00-00-000Z.db'), 'x');
		writeFileSync(join(backups(), 'something-else.db'), 'x');
		const kinds = Object.fromEntries(listSnapshots(dir.path).map((item) => [item.name, item.kind]));
		expect(kinds['pre-migrate-2026-10-01T00-00-00-000Z.db']).toBe('pre-migrate');
		expect(kinds['something-else.db']).toBe('other');
	});

	it('ignores folders, files that are not database files, and names it would not serve', () => {
		mkdirSync(backups(), { recursive: true });
		mkdirSync(join(backups(), 'a-folder.db'));
		writeFileSync(join(backups(), 'notes.txt'), 'x');
		writeFileSync(join(backups(), '.hidden.db'), 'x');
		writeFileSync(join(backups(), 'has space.db'), 'x');
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('is empty, not an error, when the folder does not exist', () => {
		rmSync(backups(), { recursive: true, force: true });
		expect(listSnapshots(dir.path)).toEqual([]);
	});
});

describe('names are never paths', () => {
	it.each([
		'manual-2026-10-12T12-00-00-000Z.db',
		'pre-delete-my-deck-2026-10-12T12-00-00-000Z-1.db',
		'a.db',
		'A_b-c.1.db'
	])('accepts %s', (name) => {
		expect(isSafeBackupName(name)).toBe(true);
	});

	it.each([
		'',
		'..',
		'../x.db',
		'..\\x.db',
		'a/b.db',
		'/etc/passwd',
		'x.db/',
		'x.DB',
		'x.db.bak',
		'.hidden.db',
		'-rf.db',
		'a b.db',
		'a%2fb.db',
		'a..b.db',
		'manual-..-x.db',
		'a\u0000.db',
		`${'x'.repeat(118)}.db`,
		'tessera.db'
	])('refuses %j', (name) => {
		expect(isSafeBackupName(name)).toBe(false);
	});

	it('refuses the live database file by name, and everything outside the pattern', () => {
		expect(isSafeBackupName('tessera.db')).toBe(false);
		expect(isSafeBackupName('tessera.db-wal')).toBe(false);
	});
});

describe('snapshotKindOf', () => {
	it.each([
		['manual-2026.db', 'manual'],
		['pre-migrate-2026.db', 'pre-migrate'],
		['pre-delete-d-2026.db', 'pre-delete'],
		['pre-reset-d-2026.db', 'pre-reset'],
		['pre-restore-2026.db', 'pre-restore'],
		['premanual.db', 'other'],
		['x.db', 'other']
	])('reads %s as %s', (name, kind) => {
		expect(snapshotKindOf(name)).toBe(kind);
	});
});

describe('withSnapshot: no snapshot, no action', () => {
	it('takes the snapshot first and then runs the action, and returns both', () => {
		const order: string[] = [];
		const result = withSnapshot(
			handle.sqlite,
			dir.path,
			{ kind: 'pre-delete', subject: 'd1', clock },
			() => {
				order.push(`action sees ${listSnapshots(dir.path).length} snapshot(s)`);
				return 'done';
			}
		);
		expect(order).toEqual(['action sees 1 snapshot(s)']);
		expect(result.value).toBe('done');
		expect(result.snapshot.kind).toBe('pre-delete');
	});

	it('does not run the action when the disk is full, and the caller gets a plain 507', () => {
		let ran = false;
		const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
		let caught: unknown;
		try {
			withSnapshot(
				handle.sqlite,
				dir.path,
				{
					kind: 'pre-delete',
					subject: 'd1',
					clock,
					write: () => {
						throw full;
					}
				},
				() => {
					ran = true;
				}
			);
		} catch (error) {
			caught = error;
		}
		expect(ran).toBe(false);
		expect(caught).toBe(full);
		expect(toErrorResponse(caught).status).toBe(507);
		expect(listSnapshots(dir.path)).toEqual([]);
	});

	it('does not run the action for any other failure to write the snapshot either', () => {
		let ran = false;
		expect(() =>
			withSnapshot(
				handle.sqlite,
				dir.path,
				{
					kind: 'pre-reset',
					subject: 'd1',
					clock,
					write: () => {
						throw new Error('boom');
					}
				},
				() => {
					ran = true;
				}
			)
		).toThrow('boom');
		expect(ran).toBe(false);
	});

	it('removes a half-written snapshot file when writing it failed', () => {
		const half = { name: '' };
		expect(() =>
			withSnapshot(
				handle.sqlite,
				dir.path,
				{
					kind: 'pre-delete',
					subject: 'd1',
					clock,
					write: (_sqlite, path) => {
						half.name = path;
						writeFileSync(path, 'half');
						throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
					}
				},
				() => undefined
			)
		).toThrow();
		expect(half.name).not.toBe('');
		expect(existsSync(half.name)).toBe(false);
	});

	it('lets an error from the action itself through, and keeps the snapshot', () => {
		expect(() =>
			withSnapshot(handle.sqlite, dir.path, { kind: 'pre-delete', subject: 'd1', clock }, () => {
				throw new Error('the action failed');
			})
		).toThrow('the action failed');
		expect(listSnapshots(dir.path)).toHaveLength(1);
	});
});
