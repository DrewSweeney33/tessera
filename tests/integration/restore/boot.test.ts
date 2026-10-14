import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { createSnapshot } from '#lib/server/backups/index.ts';
import { listDecks } from '#lib/server/repos/index.ts';
import { PENDING_FILE, readLastRestore, stageRestore } from '#lib/server/restore/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';
import { importForSetup } from '../../helpers/setup-import.ts';

// A staged restore is applied when the server starts, before the database is opened (ADR-014).

let dir: TempDir;
const logged: string[] = [];
const clock = fakeClock('2026-10-12T12:00:00.000Z');
let app: AppContext | undefined;

const start = () => {
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
	return app;
};

beforeEach(() => {
	dir = makeTempDir();
	logged.length = 0;
});

afterEach(() => {
	if (app?.database.sqlite.open) app.database.close();
	app = undefined;
	dir.cleanup();
});

function seed(target: AppContext, id: string) {
	importForSetup(target.db, makeDeck([basic(`${id}-1`)], { id, title: id }), clock);
}

describe('starting the server with a restore staged', () => {
	it('restores the backup before the database is opened, and runs on it', () => {
		const first = start();
		seed(first, 'kept');
		const backup = createSnapshot(first.database.sqlite, dir.path, 'manual', clock);
		seed(first, 'later');
		first.database.close();
		expect(stageRestore(dir.path, backup.name, clock).ok).toBe(true);

		const second = start();
		expect(listDecks(second.db).map((d) => d.id)).toEqual(['kept']);
		expect(existsSync(join(dir.path, PENDING_FILE))).toBe(false);
		expect(readLastRestore(dir.path)).toMatchObject({ ok: true, name: backup.name });
		expect(logged.join('\n')).toContain('restore applied');
		expect(readdirSync(dir.path).some((n) => n.startsWith('tessera.db.before-restore-'))).toBe(
			true
		);
	});

	it('starts normally on the old data, and says why, when the restore cannot be done', () => {
		const first = start();
		seed(first, 'kept');
		first.database.close();
		writeFileSync(
			join(dir.path, PENDING_FILE),
			JSON.stringify({ name: 'gone.db', oldName: 'tessera.db.before-restore-x' })
		);

		const second = start();
		expect(listDecks(second.db).map((d) => d.id)).toEqual(['kept']);
		expect(readLastRestore(dir.path)).toMatchObject({ ok: false });
		expect(logged.join('\n')).toContain('restore could not be done');
	});

	it('does nothing at all when nothing is staged', () => {
		const first = start();
		seed(first, 'kept');
		first.database.close();
		const second = start();
		expect(listDecks(second.db).map((d) => d.id)).toEqual(['kept']);
		expect(readLastRestore(dir.path)).toBeUndefined();
		expect(logged.join('\n')).not.toContain('restore applied');
	});
});
