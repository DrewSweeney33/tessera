import { describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config.ts';

function parsed(env: Record<string, string | undefined>) {
	const result = parseConfig(env);
	if (!result.ok) throw new Error(`expected ok, got: ${result.error.join('; ')}`);
	return result.value;
}

function problems(env: Record<string, string | undefined>): string[] {
	const result = parseConfig(env);
	if (result.ok) throw new Error('expected failure');
	return result.error;
}

describe('parseConfig', () => {
	it('applies defaults for an empty environment', () => {
		expect(parsed({})).toEqual({
			port: 3000,
			dataDir: './data',
			apiToken: undefined,
			allowedHosts: undefined,
			timeZone: 'UTC',
			logLevel: 'info',
			origin: undefined
		});
	});

	it('treats blank variables as unset', () => {
		const config = parsed({ PORT: '', TESSERA_API_TOKEN: '  ', TZ: '', LOG_LEVEL: '' });
		expect(config.port).toBe(3000);
		expect(config.apiToken).toBeUndefined();
		expect(config.timeZone).toBe('UTC');
		expect(config.logLevel).toBe('info');
	});

	it('reads explicit values', () => {
		const token = 'a'.repeat(32);
		const config = parsed({
			PORT: '8080',
			DATA_DIR: '/data',
			TESSERA_API_TOKEN: token,
			TZ: 'America/Chicago',
			LOG_LEVEL: 'debug',
			ORIGIN: 'https://tessera.example.com'
		});
		expect(config).toMatchObject({
			port: 8080,
			dataDir: '/data',
			apiToken: token,
			timeZone: 'America/Chicago',
			logLevel: 'debug',
			origin: 'https://tessera.example.com'
		});
	});

	it('parses allowed hosts, lowercasing, trimming, and dropping empties', () => {
		const config = parsed({ TESSERA_ALLOWED_HOSTS: ' Tessera.Lan , localhost:3000,, ' });
		expect(config.allowedHosts).toEqual(['tessera.lan', 'localhost:3000']);
		expect(parsed({ TESSERA_ALLOWED_HOSTS: ' , ' }).allowedHosts).toBeUndefined();
	});

	it('rejects a short API token and names the remedy', () => {
		const list = problems({ TESSERA_API_TOKEN: 'short' });
		expect(list).toHaveLength(1);
		expect(list[0]).toContain('TESSERA_API_TOKEN');
		expect(list[0]).toContain('at least 24 characters');
	});

	it('rejects invalid port, time zone, log level, and origin, reporting all problems at once', () => {
		const list = problems({
			PORT: '70000',
			TZ: 'Mars/Olympus',
			LOG_LEVEL: 'chatty',
			ORIGIN: 'not a url'
		});
		expect(list.map((p) => p.split(':')[0]).sort()).toEqual(['LOG_LEVEL', 'ORIGIN', 'PORT', 'TZ']);
	});

	it('rejects a non-numeric port', () => {
		expect(problems({ PORT: 'abc' })[0]).toContain('PORT');
	});

	it('ignores unrelated environment variables', () => {
		expect(parsed({ PATH: '/usr/bin', HOME: '/root' }).port).toBe(3000);
	});

	it('returns a frozen config', () => {
		const config = parsed({ TESSERA_ALLOWED_HOSTS: 'a.lan' });
		expect(Object.isFrozen(config)).toBe(true);
		expect(Object.isFrozen(config.allowedHosts)).toBe(true);
	});
});
