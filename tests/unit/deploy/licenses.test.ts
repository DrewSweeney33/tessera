import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLOWED_LICENSES, isAllowed, productionLicenses } from '../../../scripts/lib/licenses.ts';

describe('isAllowed', () => {
	it('accepts single permissive licenses', () => {
		for (const id of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'MPL-2.0', '0BSD']) {
			expect(isAllowed(id), id).toBe(true);
		}
	});

	it('rejects copyleft and unknown licenses', () => {
		for (const id of [
			'GPL-3.0-only',
			'AGPL-3.0-or-later',
			'LGPL-2.1',
			'SSPL-1.0',
			'UNLICENSED',
			'Custom'
		]) {
			expect(isAllowed(id), id).toBe(false);
		}
	});

	it('needs one allowed alternative for OR', () => {
		expect(isAllowed('(MPL-2.0 OR Apache-2.0)')).toBe(true);
		expect(isAllowed('GPL-3.0-only OR MIT')).toBe(true);
		expect(isAllowed('GPL-3.0-only OR LGPL-2.1')).toBe(false);
	});

	it('needs every part for AND, and AND binds tighter than OR', () => {
		expect(isAllowed('MIT AND ISC')).toBe(true);
		expect(isAllowed('MIT AND GPL-3.0-only')).toBe(false);
		expect(isAllowed('GPL-3.0-only OR (MIT AND ISC)')).toBe(true);
		expect(isAllowed('GPL-3.0-only OR MIT AND GPL-2.0-only')).toBe(false);
	});

	it('treats WITH exceptions and plus signs as the base license', () => {
		expect(isAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true);
		expect(isAllowed('Apache-2.0+')).toBe(true);
	});

	it('rejects empty or malformed expressions', () => {
		expect(isAllowed('')).toBe(false);
		expect(isAllowed('MIT OR')).toBe(false);
		expect(isAllowed('OR MIT')).toBe(false);
		expect(isAllowed('MIT ISC')).toBe(false);
		expect(isAllowed('(MIT OR ISC')).toBe(false);
		expect(isAllowed('MIT OR ISC)')).toBe(false);
		expect(isAllowed('MIT AND')).toBe(false);
	});

	it('is case-insensitive about operators', () => {
		expect(isAllowed('MIT or ISC')).toBe(true);
	});
});

describe('productionLicenses', () => {
	it('skips dev packages, the root, and links, and flags missing licenses', () => {
		const findings = productionLicenses({
			packages: {
				'': { version: '0.0.1' },
				'node_modules/zod': { version: '4.6.5', license: 'MIT' },
				'node_modules/vite': { version: '8.3.4', license: 'MIT', dev: true },
				'node_modules/@scope/pkg': { version: '1.0.0', license: 'GPL-3.0-only' },
				'node_modules/a/node_modules/nested': { version: '2.0.0', license: 'ISC' },
				'node_modules/mystery': { version: '0.1.0' },
				'node_modules/linked': { link: true }
			}
		});
		expect(findings.map((f) => [f.name, f.allowed])).toEqual([
			['@scope/pkg', false],
			['mystery', false],
			['nested', true],
			['zod', true]
		]);
		expect(findings.find((f) => f.name === 'mystery')?.license).toBe('UNKNOWN');
	});
});

describe('this repository', () => {
	it('ships only allowed licenses in production', () => {
		const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
		const rejected = productionLicenses(lock).filter((f) => !f.allowed);
		expect(rejected, JSON.stringify(rejected)).toEqual([]);
	});

	it('has an allow list that matches the staff-engineer standard', () => {
		for (const id of ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0']) {
			expect(ALLOWED_LICENSES.has(id)).toBe(true);
		}
		expect(ALLOWED_LICENSES.has('GPL-3.0-only')).toBe(false);
	});
});
