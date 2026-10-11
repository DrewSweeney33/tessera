import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleImport } from '#lib/server/api/import.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The preview a person approves must be what the import then does (M2-09).

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

const deck = (cards: Record<string, unknown>[]) => ({
	tessera: 1,
	deck: { id: 'prev', title: 'Preview' },
	cards
});
const basic = (id: string, back = `A ${id}`) => ({ id, type: 'basic', front: `Q ${id}`, back });

async function send(body: unknown, query = '') {
	const response = await handleImport(
		app,
		new Request(`http://localhost/api/import${query}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		'req-1'
	);
	return { response, body: await response.json() };
}

describe('the preview is what the import does', () => {
	it.each([
		['plain', ''],
		['archiving missing cards', '&archive_missing=true']
	])('gives the same counts and warnings as the import, %s', async (_name, extra) => {
		await send(deck([basic('a'), basic('b'), basic('c'), basic('d')]));
		const revised = deck([
			basic('a', 'edited'),
			{ id: 'b', type: 'typed', front: 'Q b', answer: 'A b' },
			basic('e'),
			basic('f'),
			basic('g')
		]);
		const preview = await send(revised, `?dry_run=true${extra}`);
		const committed = await send(revised, `?${extra.slice(1)}`);

		expect(preview.body.plan.counts).toEqual(committed.body.result.counts);
		expect(preview.body.plan.warnings).toEqual(committed.body.result.warnings);
		expect(preview.body.plan.warnings.map((w: { code: string }) => w.code)).toEqual([
			'type_changed',
			'mostly_replaced'
		]);
		expect(committed.body.result.counts).toMatchObject({ updated: 1, typeChanged: 1, new: 3 });
	});

	it('shows each edit as old and new text', async () => {
		await send(deck([basic('a', 'old answer')]));
		const { body } = await send(deck([basic('a', 'new answer')]), '?dry_run=true');
		expect(body.plan.cards[0]).toMatchObject({
			key: 'a',
			action: 'updated',
			changes: [{ field: 'back', before: 'old answer', after: 'new answer', cut: false }],
			progressLost: 0
		});
	});

	it('cuts very long text and says it was cut', async () => {
		await send(deck([basic('a', 'x')]));
		const { body } = await send(deck([basic('a', 'y'.repeat(1000))]), '?dry_run=true');
		const [change] = body.plan.cards[0].changes;
		expect(change.after).toHaveLength(300);
		expect(change.before).toBe('x');
		expect(change.cut).toBe(true);
	});

	it('gives old and new text for the first 50 changed cards only, to keep the reply small', async () => {
		const many = Array.from({ length: 60 }, (_, i) => basic(`c${i}`));
		await send(deck(many));
		const edited = many.map((card) => ({ ...card, back: 'edited' }));
		const { body } = await send(deck(edited), '?dry_run=true');
		expect(body.plan.cards).toHaveLength(60);
		expect(body.plan.cards[49].changes).toHaveLength(1);
		expect(body.plan.cards[50].changes).toBeUndefined();
		expect(body.plan.counts.updated).toBe(60);
	});

	it('lists at most 200 missing cards but counts them all', async () => {
		await send(deck(Array.from({ length: 250 }, (_, i) => basic(`m${i}`))));
		const { body } = await send(deck([basic('m0')]), '?dry_run=true');
		expect(body.plan.absent).toHaveLength(200);
		expect(body.plan.counts.absent).toBe(249);
	});
});
