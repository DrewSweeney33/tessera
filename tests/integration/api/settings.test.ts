import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SettingsResponse } from '#lib/core/api-types.ts';
import { DEFAULT_SETTINGS } from '#lib/core/settings.ts';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { handleGetSettings, handleUpdateSettings } from '#lib/server/api/settings.ts';
import { commitImport } from '#lib/server/import/index.ts';
import { getSettings } from '#lib/server/repos/index.ts';
import { countQueue } from '#lib/server/study/index.ts';
import { basic, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// The settings over HTTP (M3-09): read them, change some, and every change is all or nothing.

let dir: TempDir;
let app: AppContext;
const logged: string[] = [];
const clock = fakeClock('2026-10-12T12:00:00.000Z');

beforeEach(() => {
	dir = makeTempDir();
	logged.length = 0;
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock,
		log: createLogger({ level: 'debug', write: (line) => logged.push(line) })
	});
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const put = (body: unknown, raw = false) =>
	handleUpdateSettings(
		app,
		new Request('http://localhost/api/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: raw ? (body as string) : JSON.stringify(body)
		}),
		'req'
	);
const errorOf = async (response: Response) =>
	(
		(await response.json()) as {
			error: { code: string; message: string; details?: { errors?: { path: string }[] } };
		}
	).error;

describe('GET /api/settings', () => {
	it('gives the settings, the defaults, and the time zone the server uses', async () => {
		const response = handleGetSettings(app);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = (await response.json()) as SettingsResponse;
		expect(body.settings).toEqual(DEFAULT_SETTINGS);
		expect(body.defaults).toEqual(DEFAULT_SETTINGS);
		expect(body.timeZone).toBe('America/Chicago');
	});

	it('shows a changed setting', async () => {
		await put({ newPerDay: 7 });
		const body = (await handleGetSettings(app).json()) as SettingsResponse;
		expect(body.settings.newPerDay).toBe(7);
		expect(body.defaults.newPerDay).toBe(DEFAULT_SETTINGS.newPerDay);
	});
});

describe('PUT /api/settings', () => {
	it('changes just the settings sent, and answers with all of them', async () => {
		const response = await put({ newPerDay: 5, interleave: true });
		expect(response.status).toBe(200);
		const body = (await response.json()) as SettingsResponse;
		expect(body.settings).toEqual({ ...DEFAULT_SETTINGS, newPerDay: 5, interleave: true });
		expect(getSettings(app.db)).toEqual(body.settings);
	});

	it('takes effect in the study queue at once', async () => {
		const result = commitImport(
			app.db,
			makeDeck(
				Array.from({ length: 10 }, (_, i) => basic(`c${i}`)),
				{ id: 'd', title: 'D' }
			),
			{ archiveMissing: false, format: 'json' },
			clock
		);
		if (!result.ok) throw new Error('setup');
		const count = () =>
			countQueue(app.db, { scope: {}, now: clock.now(), timeZone: 'America/Chicago' }).new;
		expect(count()).toBe(10);
		await put({ newPerDay: 3 });
		expect(count()).toBe(3);
		await put({ newPerDay: 0 });
		expect(count()).toBe(0);
	});

	it('is all or nothing: one bad value means nothing is saved', async () => {
		const response = await put({ newPerDay: 5, leechThreshold: 1, rolloverHour: 30 });
		expect(response.status).toBe(422);
		const error = await errorOf(response);
		expect(error.code).toBe('validation_failed');
		expect(error.details?.errors?.map((e) => e.path).sort()).toEqual([
			'leechThreshold',
			'rolloverHour'
		]);
		expect(getSettings(app.db)).toEqual(DEFAULT_SETTINGS);
	});

	it('puts back what it had already saved if saving fails part way', async () => {
		app.database.sqlite.exec(
			"create trigger refuse_leech before insert on settings when new.key = 'leechThreshold' begin select raise(abort, 'refused'); end;"
		);
		await expect(put({ newPerDay: 5, leechThreshold: 10 })).rejects.toThrow(/refused/);
		expect(getSettings(app.db)).toEqual(DEFAULT_SETTINGS);
	});

	it('refuses a setting that does not exist, and saves nothing', async () => {
		const response = await put({ newPerDay: 5, secret: true });
		expect(response.status).toBe(422);
		expect((await errorOf(response)).details?.errors?.[0]?.path).toBe('secret');
		expect(getSettings(app.db).newPerDay).toBe(DEFAULT_SETTINGS.newPerDay);
	});

	it.each([
		['an empty set', {}],
		['an array', []],
		['null', null],
		['a number', 5]
	])('refuses %s with a 422', async (_label, body) => {
		expect((await put(body)).status).toBe(422);
	});

	it.each([
		['no body', ''],
		['text that is not JSON', 'nope']
	])('refuses %s with a 400', async (_label, raw) => {
		expect((await put(raw, true)).status).toBe(400);
	});

	it('refuses a body over the small limit', async () => {
		expect((await put({ newPerDay: 5, pad: 'x'.repeat(20_000) })).status).toBe(413);
	});

	it('accepts the same value again, so saving twice is harmless', async () => {
		expect((await put({ newPerDay: 9 })).status).toBe(200);
		expect((await put({ newPerDay: 9 })).status).toBe(200);
	});

	it('logs which settings changed and to what, which are numbers and not secrets', async () => {
		await put({ newPerDay: 9, interleave: true });
		const lines = logged.join('\n');
		expect(lines).toContain('settings changed');
		expect(lines).toContain('newPerDay');
	});

	it('does not echo what was sent in an error', async () => {
		const response = await put({ newPerDay: '<script>alert(1)</script>' });
		expect(await response.text()).not.toContain('<script>');
	});
});
