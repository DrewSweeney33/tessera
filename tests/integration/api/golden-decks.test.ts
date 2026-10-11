import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The example decks are what the README and the guides tell people to import first, so they go through the real
// import route, in the format each is written in.

let dir: TempDir;
let app: AppContext;

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock: fakeClock(),
		log: createLogger({ level: 'error', write: () => undefined })
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const files = readdirSync('examples').filter((f) => /\.(json|md)$/.test(f));

async function send(file: string, query = '') {
	const type = file.endsWith('.json') ? 'application/json' : 'text/markdown';
	const response = await handleImport(
		app,
		new Request(`http://localhost/api/import${query}`, {
			method: 'POST',
			headers: { 'content-type': type },
			body: readFileSync(join('examples', file), 'utf8')
		}),
		'req-1'
	);
	return { response, body: await response.json() };
}

describe('the example decks, through the import route', () => {
	it.each(files)('%s previews, imports, and imports again with nothing changed', async (file) => {
		const preview = await send(file, '?dry_run=true');
		expect(preview.response.status, JSON.stringify(preview.body)).toBe(200);
		expect(preview.body.plan.deck.action).toBe('created');
		expect(preview.body.plan.counts.new).toBeGreaterThanOrEqual(10);
		// Every card has an id, so there is nothing to warn about.
		expect(preview.body.plan.warnings).toEqual([]);

		const first = await send(file);
		expect(first.response.status).toBe(200);
		expect(first.body.result.counts.new).toBe(preview.body.plan.counts.new);
		expect(first.body.result.warnings).toEqual([]);

		const again = await send(file);
		expect(again.body.result).toMatchObject({
			changed: false,
			counts: { new: 0, updated: 0, typeChanged: 0 }
		});
	});

	it('the CCNA deck in Markdown is unchanged after the same deck was imported as JSON, and the other way round', async () => {
		await send('ccna-ospf.json');
		const asMarkdown = await send('ccna-ospf.md');
		expect(asMarkdown.body.result).toMatchObject({
			changed: false,
			counts: { new: 0, updated: 0, typeChanged: 0 }
		});
	});

	it('every deck can be imported into the same instance together', async () => {
		for (const file of files) expect((await send(file)).response.status, file).toBe(200);
		const decks = (
			app.database.sqlite.prepare('select id from decks order by id').all() as { id: string }[]
		).map((row) => row.id);
		expect(decks).toEqual(['ccna-ospf', 'powershell-essentials', 'tcp-ip-fundamentals']);
	});
});
