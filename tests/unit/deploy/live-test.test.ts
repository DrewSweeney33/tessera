import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
	MARKER_FILE,
	TEST_DIR,
	TEST_NAME,
	assertSafe,
	buildCompose,
	composeCommand,
	extractGuideCommands,
	layoutFor,
	parseSshTarget,
	setupCommand,
	sshArgs,
	teardownCommand
} from '../../../scripts/lib/live-test.ts';

// The live-image harness (ADR-012) runs commands on a real Docker host. Its safety rules are the whole point,
// so each one is tested, including by trying to break it: the harness must refuse to touch the live instance.

const repoCompose = readFileSync('compose.yaml', 'utf8');
const own = (parse(repoCompose) as { services: Record<string, Record<string, unknown>> }).services[
	'tessera'
]!;

function composeOf(options: Partial<Parameters<typeof buildCompose>[0]> = {}) {
	const text = buildCompose({
		image: 'ghcr.io/drewsweeney33/tessera:0.1.0',
		bindHost: '192.168.30.102',
		ports: layoutFor(3001),
		repoCompose,
		...options
	});
	return parse(text) as {
		name: string;
		services: Record<string, Record<string, unknown> & { environment?: Record<string, string> }>;
		volumes: Record<string, { driver?: string; driver_opts?: Record<string, string> } | null>;
	};
}

describe('the ssh target', () => {
	it.each(['andrew@192.168.30.102', 'me@docker-host', 'ops_1@host.example.com'])(
		'accepts %s',
		(text) => {
			expect(parseSshTarget(text)).toEqual({ user: text.split('@')[0], host: text.split('@')[1] });
		}
	);

	it.each([
		['no user', 'host'],
		['empty', ''],
		['a space', 'a b@host'],
		['a command after it', 'andrew@host; rm -rf /'],
		['a quote', 'andrew@host"x'],
		['an option posing as a host', '-oProxyCommand=x@host'],
		['a host that starts with a dash', 'andrew@-host'],
		['a path', 'andrew@host/../x'],
		['a newline', 'andrew@host\nx']
	])('refuses %s, so nothing odd can reach a command line', (_label, text) => {
		expect(() => parseSshTarget(text)).toThrow();
	});
});

describe('the port layout', () => {
	it('uses five consecutive ports starting at the base', () => {
		expect(layoutFor(3001)).toEqual({
			main: 3001,
			hosts: 3002,
			token: 3003,
			tiny: 3004,
			restored: 3005
		});
	});
});

describe('the safety rules', () => {
	const ok = { basePort: 3001, livePort: 3000, liveDir: '/opt/tessera' };

	it('accept a normal setup', () => {
		expect(() => assertSafe(ok)).not.toThrow();
	});

	it('refuse the live instance port as the base port', () => {
		expect(() => assertSafe({ ...ok, basePort: 3000 })).toThrow(/live/i);
	});

	it('refuse any layout port that is the live port, not only the first', () => {
		expect(() => assertSafe({ ...ok, basePort: 2997 })).toThrow(/live/i);
		expect(() => assertSafe({ ...ok, basePort: 2999 })).toThrow(/live/i);
	});

	it.each([0, 80, 1023, 65531, 70000, 3001.5, Number.NaN])(
		'refuse the unusable base port %s',
		(port) => {
			expect(() => assertSafe({ ...ok, basePort: port })).toThrow();
		}
	);

	it('refuse a live folder that is the test folder, inside it, or around it', () => {
		for (const liveDir of [TEST_DIR, `${TEST_DIR}/sub`, '/opt', '/', '/opt/']) {
			expect(() => assertSafe({ ...ok, liveDir }), liveDir).toThrow(/folder/i);
		}
	});

	it('are not fooled by a live folder that merely starts with the same letters', () => {
		expect(() => assertSafe({ ...ok, liveDir: '/opt/tessera-test2' })).not.toThrow();
	});

	it('work without a live folder given', () => {
		expect(() => assertSafe({ basePort: 3001, livePort: 3000 })).not.toThrow();
	});
});

describe('the test folder and its marker', () => {
	it('is one fixed folder whose name says it is a test', () => {
		expect(TEST_DIR).toBe('/opt/tessera-test');
		expect(TEST_NAME).toBe('tessera-test');
	});

	it('has every command stay inside it', () => {
		for (const command of [setupCommand(), teardownCommand()]) {
			const paths = command.match(/\/[A-Za-z0-9_./-]+/g) ?? [];
			for (const path of paths)
				expect(path.startsWith(TEST_DIR), `${path} in ${command}`).toBe(true);
		}
	});

	it('removes the folder only when it carries the marker', () => {
		const command = teardownCommand();
		expect(command).toContain(`-f ${TEST_DIR}/${MARKER_FILE}`);
		expect(command.indexOf(MARKER_FILE)).toBeLessThan(command.indexOf('rm -rf'));
		expect(command).toContain('down -v');
	});

	it('names the compose project, so a live project of another name cannot be reached', () => {
		expect(composeCommand('ps')).toBe(
			`docker compose -p ${TEST_NAME} -f ${TEST_DIR}/compose.yaml ps`
		);
	});

	it('connects without ever asking for a password', () => {
		const args = sshArgs({ user: 'andrew', host: '192.168.30.102' });
		expect(args).toContain('BatchMode=yes');
		expect(args.at(-1)).toBe('andrew@192.168.30.102');
	});
});

describe('the generated compose file', () => {
	const file = composeOf();

	it('is its own project and builds nothing', () => {
		expect(file.name).toBe(TEST_NAME);
		for (const service of Object.values(file.services)) {
			expect(service['build']).toBeUndefined();
			expect(service['image']).toBe('ghcr.io/drewsweeney33/tessera:0.1.0');
			expect(service['container_name']).toBeUndefined();
		}
	});

	it('has the five services, each on its own port of the host address', () => {
		expect(Object.keys(file.services).sort()).toEqual([
			'hosts',
			'main',
			'restored',
			'tiny',
			'token'
		]);
		expect(file.services['main']!['ports']).toEqual(['192.168.30.102:3001:3000']);
		expect(file.services['hosts']!['ports']).toEqual(['192.168.30.102:3002:3000']);
		expect(file.services['token']!['ports']).toEqual(['192.168.30.102:3003:3000']);
		expect(file.services['tiny']!['ports']).toEqual(['192.168.30.102:3004:3000']);
		expect(file.services['restored']!['ports']).toEqual(['192.168.30.102:3005:3000']);
	});

	it.each(['init', 'restart', 'read_only', 'tmpfs', 'cap_drop', 'security_opt', 'logging'])(
		'keeps the %s hardening of the repository compose.yaml on every service',
		(key) => {
			for (const service of Object.values(file.services))
				expect(service[key], key).toEqual(own[key]);
		}
	);

	it('caps memory, as the deployment guide recommends', () => {
		for (const service of Object.values(file.services)) expect(service['mem_limit']).toBe('512m');
	});

	it('runs the main service with the image defaults, which the probe assumes', () => {
		const names = Object.keys(file.services['main']!.environment ?? {});
		for (const forbidden of [
			'ORIGIN',
			'PROTOCOL_HEADER',
			'HOST_HEADER',
			'TESSERA_ALLOWED_HOSTS',
			'TESSERA_API_TOKEN'
		]) {
			expect(names).not.toContain(forbidden);
		}
	});

	it('gives the hosts and token services the probe settings, and only those', () => {
		expect(file.services['hosts']!.environment?.['TESSERA_ALLOWED_HOSTS']).toContain(
			'tessera.example.test'
		);
		expect(file.services['hosts']!.environment?.['TESSERA_API_TOKEN']).toBeUndefined();
		expect(file.services['token']!.environment?.['TESSERA_API_TOKEN']).toMatch(/^probe-token-/);
		expect(file.services['token']!.environment?.['TESSERA_ALLOWED_HOSTS']).toBeUndefined();
	});

	it('gives every service its own volume, none of them the live one', () => {
		const used = Object.values(file.services).map((service) => service['volumes']);
		const names = used.map((list) => String((list as string[])[0]).split(':')[0]);
		expect(new Set(names).size).toBe(5);
		for (const name of names) expect(name).not.toBe('tessera-data');
		expect(Object.keys(file.volumes).sort()).toEqual(
			['hosts_data', 'main_data', 'restored_data', 'tiny_data', 'token_data'].sort()
		);
	});

	it('limits the small volume to a few megabytes in memory, never the host disk', () => {
		const tiny = file.volumes['tiny_data']!;
		expect(tiny.driver).toBe('local');
		expect(tiny.driver_opts?.['type']).toBe('tmpfs');
		expect(tiny.driver_opts?.['o']).toMatch(/size=\d+m/);
		expect(Number(/size=(\d+)m/.exec(tiny.driver_opts?.['o'] ?? '')?.[1])).toBeLessThanOrEqual(16);
	});

	it('publishes nothing on the live port', () => {
		const text = buildCompose({
			image: 'x:1',
			bindHost: '10.0.0.5',
			ports: layoutFor(3001),
			repoCompose
		});
		expect(text).not.toMatch(/:3000:3000/);
	});
});

describe('the commands taken from the operations guide', () => {
	const guide = readFileSync('docs/operations.md', 'utf8');
	const found = extractGuideCommands(guide);

	it('are found in the guide as written', () => {
		expect(found.backupScript).toContain('VACUUM INTO');
		expect(found.checkScript).toContain('integrity_check');
	});

	it('are the very scripts the guide prints, untouched', () => {
		expect(guide).toContain(`node -e "${found.backupScript}"`);
		expect(guide).toContain(`node -e "${found.checkScript}"`);
	});

	it('fail loudly if the guide changes shape, instead of testing nothing', () => {
		expect(() => extractGuideCommands('no commands here')).toThrow(/operations guide/i);
	});
});
