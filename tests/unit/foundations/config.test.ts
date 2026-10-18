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
			password: undefined,
			maxBackups: 10,
			allowedHosts: undefined,
			timeZone: 'UTC',
			logLevel: 'info'
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
			LOG_LEVEL: 'debug'
		});
		expect(config).toMatchObject({
			port: 8080,
			dataDir: '/data',
			apiToken: token,
			timeZone: 'America/Chicago',
			logLevel: 'debug'
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

	it('reads the page password and the backup limit', () => {
		const password = 'correct horse battery';
		const config = parsed({ TESSERA_PASSWORD: password, TESSERA_MAX_BACKUPS: '25' });
		expect(config.password).toBe(password);
		expect(config.maxBackups).toBe(25);
		expect(parsed({ TESSERA_PASSWORD: '  ', TESSERA_MAX_BACKUPS: '' })).toMatchObject({
			password: undefined,
			maxBackups: 10
		});
	});

	it('rejects a short or over-long password without echoing it', () => {
		const short = problems({ TESSERA_PASSWORD: 'tooshort' });
		expect(short).toHaveLength(1);
		expect(short[0]).toContain('TESSERA_PASSWORD');
		expect(short[0]).toContain('at least 12 characters');
		expect(short[0]).not.toContain('tooshort');
		expect(problems({ TESSERA_PASSWORD: 'x'.repeat(201) })[0]).toContain('at most 200');
	});

	it('rejects a backup limit outside 1 to 1000', () => {
		for (const value of ['0', '1001', '-3', '2.5', 'many']) {
			expect(problems({ TESSERA_MAX_BACKUPS: value })[0]).toContain('TESSERA_MAX_BACKUPS');
		}
		expect(parsed({ TESSERA_MAX_BACKUPS: '1' }).maxBackups).toBe(1);
		expect(parsed({ TESSERA_MAX_BACKUPS: '1000' }).maxBackups).toBe(1000);
	});

	it('rejects invalid port, time zone, and log level, reporting all problems at once', () => {
		const list = problems({ PORT: '70000', TZ: 'Mars/Olympus', LOG_LEVEL: 'chatty' });
		expect(list.map((p) => p.split(':')[0]).sort()).toEqual(['LOG_LEVEL', 'PORT', 'TZ']);
	});

	it('does not read ORIGIN, which adapter-node 6 ignores (ADR-006)', () => {
		expect(parsed({ ORIGIN: 'not a url' })).not.toHaveProperty('origin');
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
