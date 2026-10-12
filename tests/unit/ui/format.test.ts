import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatBytes } from '#lib/ui/format.ts';

describe('formatBytes', () => {
	it.each([
		[0, '0 B'],
		[1, '1 B'],
		[999, '999 B'],
		[1000, '1.0 kB'],
		[1536, '1.5 kB'],
		[999_949, '999.9 kB'],
		[1_000_000, '1.0 MB'],
		[55_000_000, '55.0 MB'],
		[1_234_000_000, '1.2 GB']
	])('writes %d bytes as %s', (bytes, shown) => {
		expect(formatBytes(bytes)).toBe(shown);
	});

	it('never writes a negative or non-finite size as a number', () => {
		for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(formatBytes(bad)).toBe('unknown size');
		}
	});

	it('always gives a short text with a unit (property test)', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 2 ** 45 }), (bytes) => {
				expect(formatBytes(bytes)).toMatch(/^\d+(\.\d)? (B|kB|MB|GB|TB)$/);
			}),
			{ numRuns: 500 }
		);
	});

	it('never goes down as the size goes up, within a unit (property test)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 999_000 }),
				fc.integer({ min: 0, max: 999_000 }),
				(a, b) => {
					const [low, high] = a <= b ? [a, b] : [b, a];
					const parse = (text: string) => {
						const [n, unit] = text.split(' ');
						return Number(n) * ({ B: 1, kB: 1e3, MB: 1e6 }[unit as 'B' | 'kB' | 'MB'] ?? 1e9);
					};
					expect(parse(formatBytes(low))).toBeLessThanOrEqual(parse(formatBytes(high)));
				}
			),
			{ numRuns: 500 }
		);
	});
});
