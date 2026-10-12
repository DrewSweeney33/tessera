// The pure part of the live-image harness (ADR-012): safety rules, the generated compose file, and the command
// strings. Nothing here runs a command or touches a file, so every rule can be tested. scripts/live-test.ts
// does the running.
import { parse, stringify } from 'yaml';
import { PROBE_ALLOWED_HOSTS, PROBE_TOKEN } from './probe-config.ts';

// One fixed folder and one fixed compose project name. The live instance can never have either. The folder is
// in the ssh user's home (the remote shell expands $HOME), so no root access is needed on the host.
export const TEST_NAME = 'tessera-test';
export const TEST_DIR = '$HOME/tessera-test';
export const MARKER_FILE = '.tessera-test-marker';

export interface SshTarget {
	user: string;
	host: string;
}

// user@host, and nothing that could be read as an option, a second command, or a path. The target ends up on a
// command line, so anything unusual is refused here rather than quoted.
export function parseSshTarget(text: string): SshTarget {
	const found = /^([A-Za-z_][A-Za-z0-9_-]{0,31})@([A-Za-z0-9][A-Za-z0-9.-]{0,252})$/.exec(text);
	if (!found) {
		throw new Error(
			`"${text.slice(0, 60)}" is not a usable ssh target. Use user@host, for example andrew@192.168.30.102.`
		);
	}
	return { user: found[1]!, host: found[2]! };
}

export function sshArgs(target: SshTarget): string[] {
	return [
		'-o',
		'BatchMode=yes',
		'-o',
		'ConnectTimeout=10',
		'-o',
		'ServerAliveInterval=15',
		`${target.user}@${target.host}`
	];
}

export interface Layout {
	main: number;
	hosts: number;
	token: number;
	tiny: number;
	restored: number;
}

// Five consecutive ports, one per test service.
export function layoutFor(basePort: number): Layout {
	return {
		main: basePort,
		hosts: basePort + 1,
		token: basePort + 2,
		tiny: basePort + 3,
		restored: basePort + 4
	};
}

// Refuses a setup that could reach the live instance. Throws with the reason.
export function assertSafe(options: {
	basePort: number;
	livePort: number;
	liveDir?: string;
	// The test folder as an absolute path, once the host's home folder is known.
	testDir?: string;
}): void {
	const { basePort, livePort, liveDir, testDir } = options;
	if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65530) {
		throw new Error(
			`The base port ${basePort} is not usable. Use a whole number from 1024 to 65530.`
		);
	}
	for (const port of Object.values(layoutFor(basePort))) {
		if (port === livePort) {
			throw new Error(
				`The test instance would use port ${port}, which is the live instance's port. Pick a base port whose five ports (${basePort} to ${basePort + 4}) avoid ${livePort}.`
			);
		}
	}
	if (liveDir !== undefined) {
		const live = liveDir.replace(/\/+$/, '');
		const refuse = () => {
			throw new Error(
				`The live folder ${JSON.stringify(liveDir)} is a test folder, or contains the test folder, or is inside it. Refusing: the test would risk the live data.`
			);
		};
		// Before the host's home is known: anything named like the test folder is refused wherever it is.
		if (/(^|\/)tessera-test(\/|$)/.test(live)) refuse();
		// Once it is known (the harness asks the host and checks again), the exact folder, its parents, and its insides.
		if (testDir !== undefined) {
			const test = testDir.replace(/\/+$/, '');
			const inside = (inner: string, outer: string) =>
				inner === outer || inner.startsWith(`${outer}/`);
			if (inside(live, test) || inside(test, live)) refuse();
		}
	}
}

// ---- Commands (strings for the remote shell). Every path is TEST_DIR or inside it.

export function composeCommand(args: string): string {
	return `docker compose -p ${TEST_NAME} -f ${TEST_DIR}/compose.yaml ${args}`;
}

export function setupCommand(): string {
	return `mkdir -p ${TEST_DIR} && touch ${TEST_DIR}/${MARKER_FILE}`;
}

// Takes the test instance down and removes its volumes and its folder, only when the folder carries the marker.
export function teardownCommand(): string {
	return (
		`if [ -f ${TEST_DIR}/${MARKER_FILE} ]; then ` +
		`${composeCommand('down -v --remove-orphans')} || true; ` +
		`rm -rf ${TEST_DIR}; ` +
		`else echo "no test instance here"; fi`
	);
}

// ---- The compose file

export interface ComposeOptions {
	image: string;
	// The address the ports are published on (the Docker host's own address).
	bindHost: string;
	ports: Layout;
	// The text of the repository's compose.yaml, the single source of the hardening settings.
	repoCompose: string;
}

const SERVICE_NAMES = ['main', 'hosts', 'token', 'tiny', 'restored'] as const;

export function buildCompose(options: ComposeOptions): string {
	const parsed = parse(options.repoCompose) as {
		services: Record<string, Record<string, unknown>>;
	};
	const base = parsed.services['tessera'];
	if (!base) throw new Error('The repository compose.yaml has no "tessera" service.');

	const extraEnvironment: Record<(typeof SERVICE_NAMES)[number], Record<string, string>> = {
		main: {},
		hosts: { TESSERA_ALLOWED_HOSTS: PROBE_ALLOWED_HOSTS },
		token: { TESSERA_API_TOKEN: PROBE_TOKEN },
		tiny: {},
		restored: {}
	};

	const services: Record<string, unknown> = {};
	for (const name of SERVICE_NAMES) {
		const service = structuredClone(base);
		delete service['build'];
		service['image'] = options.image;
		service['ports'] = [`${options.bindHost}:${options.ports[name]}:3000`];
		service['environment'] = { TZ: 'UTC', ...extraEnvironment[name] };
		service['volumes'] = [`${name}_data:/data`];
		service['mem_limit'] = '512m';
		services[name] = service;
	}

	const volumes: Record<string, unknown> = {};
	for (const name of SERVICE_NAMES) volumes[`${name}_data`] = null;
	// The small volume lives in memory with a hard size, so a full-disk test fills this and never the host disk.
	volumes['tiny_data'] = {
		driver: 'local',
		driver_opts: { type: 'tmpfs', device: 'tmpfs', o: 'size=8m,uid=1000,gid=1000' }
	};

	return stringify({ name: TEST_NAME, services, volumes });
}

// ---- The operations guide

export interface GuideCommands {
	backupScript: string;
	checkScript: string;
}

// The two node scripts exactly as the operations guide prints them. If the guide changes shape the harness
// stops, rather than testing something the guide no longer says.
export function extractGuideCommands(guide: string): GuideCommands {
	const backupBlock = /<!-- backup-command -->\s*```bash\n([\s\S]*?)```/.exec(guide)?.[1] ?? '';
	const backupScript = /node -e "([\s\S]*?)" \/data\/tessera\.db /.exec(backupBlock)?.[1];
	const checkScript = /node -e "([^"]*integrity_check[^"]*)" /.exec(guide)?.[1];
	if (!backupScript || !checkScript) {
		throw new Error(
			'The backup and integrity-check commands were not found in the operations guide (docs/operations.md). ' +
				'The harness tests the commands as the guide prints them, so it will not guess.'
		);
	}
	return { backupScript, checkScript };
}
