import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The harness entry point, run for real but never as far as an ssh connection: every case here either is
// refused before it connects, or is a dry run. The refusals matter most (ADR-012, rules 1 and 2).

function run(...args: string[]) {
	const result = spawnSync(process.execPath, ['scripts/live-test.ts', ...args], {
		encoding: 'utf8',
		env: { ...process.env, TESSERA_LIVE_SSH: '' },
		timeout: 30_000
	});
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const target = ['--target', 'andrew@192.168.30.102'];

describe('the harness refuses, before any connection, to run', () => {
	it('without a target', () => {
		const result = run('--dry-run');
		expect(result.status).toBe(2);
		expect(result.out).toMatch(/not a usable ssh target/);
	});

	it('with a target that could be read as an option or a second command', () => {
		for (const bad of ['-oProxyCommand=x@host', 'andrew@host; reboot', 'andrew host']) {
			const result = run('--dry-run', '--target', bad);
			expect(result.status, bad).toBe(2);
		}
	});

	it('on the live port', () => {
		const result = run('--dry-run', ...target, '--port', '3000');
		expect(result.status).toBe(2);
		expect(result.out).toMatch(/live instance's port/);
	});

	it('when any of its five ports would be the live port', () => {
		expect(run('--dry-run', ...target, '--port', '2998').status).toBe(2);
	});

	it('with a different live port, but still not on that one', () => {
		expect(run('--dry-run', ...target, '--port', '3001', '--live-port', '3003').status).toBe(2);
		expect(run('--dry-run', ...target, '--port', '3001', '--live-port', '3100').status).toBe(0);
	});

	it('when the live folder is the test folder or around it', () => {
		for (const dir of ['/opt/tessera-test', '/opt', '/']) {
			const result = run('--dry-run', ...target, '--live-dir', dir);
			expect(result.status, dir).toBe(2);
			expect(result.out).toMatch(/test folder/);
		}
	});
});

describe('the dry run', () => {
	const result = run('--dry-run', ...target, '--live-dir', '/opt/tessera');

	it('changes nothing and says what it would do', () => {
		expect(result.status).toBe(0);
		expect(result.out).toContain('Plan (nothing is changed)');
		expect(result.out).toContain('/opt/tessera-test');
		expect(result.out).toContain('project tessera-test');
	});

	it('shows the compose file with the test ports and not the live one', () => {
		expect(result.out).toContain('192.168.30.102:3001:3000');
		expect(result.out).toContain('192.168.30.102:3005:3000');
		expect(result.out).not.toContain(':3000:3000');
	});

	it('shows a teardown that only removes a folder with the marker', () => {
		expect(result.out).toMatch(/teardown:.*\.tessera-test-marker.*rm -rf \/opt\/tessera-test/);
	});

	it('names the image: the published one for the package version, or the one built here', () => {
		expect(result.out).toMatch(/image\s+ghcr\.io\/drewsweeney33\/tessera:\d+\.\d+\.\d+/);
		expect(run('--dry-run', ...target, '--build').out).toMatch(
			/tessera-test:candidate.*built on the host/
		);
	});
});
