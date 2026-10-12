import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_SETTINGS, SettingsSchema, settingProblems } from '#lib/core/settings.ts';

// The settings form and the server check a change with the same function, and say what is wrong in plain words,
// naming the setting (M3-09). A bad value is never saved, and a good one never refused.

describe('settingProblems', () => {
	it('finds nothing wrong with the defaults, or with an empty change', () => {
		expect(settingProblems(DEFAULT_SETTINGS)).toEqual([]);
		expect(settingProblems({})).toEqual([]);
	});

	it.each([
		['newPerDay', 0],
		['newPerDay', 1000],
		['reviewsPerDay', 0],
		['reviewsPerDay', 10_000],
		['targetRetention', 0.7],
		['targetRetention', 0.99],
		['rolloverHour', 0],
		['rolloverHour', 23],
		['leechThreshold', 2],
		['leechThreshold', 100],
		['interleave', true],
		['interleave', false]
	])('accepts the edge value %s = %s', (key, value) => {
		expect(settingProblems({ [key]: value })).toEqual([]);
	});

	it.each([
		['newPerDay', -1, /whole number from 0 to 1000/],
		['newPerDay', 1001, /whole number from 0 to 1000/],
		['newPerDay', 2.5, /whole number/],
		['newPerDay', '20', /whole number/],
		['newPerDay', Number.NaN, /whole number/],
		['newPerDay', null, /whole number/],
		['reviewsPerDay', -1, /whole number from 0 to 10000/],
		['reviewsPerDay', 10_001, /whole number from 0 to 10000/],
		['targetRetention', 0.69, /between 70% and 99%/],
		['targetRetention', 1, /between 70% and 99%/],
		['targetRetention', 90, /between 70% and 99%/],
		['targetRetention', '0.9', /between 70% and 99%/],
		['rolloverHour', -1, /whole number from 0 to 23/],
		['rolloverHour', 24, /whole number from 0 to 23/],
		['rolloverHour', 4.5, /whole number from 0 to 23/],
		['leechThreshold', 1, /whole number from 2 to 100/],
		['leechThreshold', 101, /whole number from 2 to 100/],
		['interleave', 'yes', /on or off/],
		['interleave', 1, /on or off/],
		['interleave', null, /on or off/]
	])('refuses %s = %j and says why', (key, value, message) => {
		const problems = settingProblems({ [key]: value });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatchObject({ path: key });
		expect(problems[0]!.message).toMatch(message);
	});

	it('names every setting that is wrong, not only the first', () => {
		const problems = settingProblems({ newPerDay: -5, leechThreshold: 1, interleave: 'x' });
		expect(problems.map((p) => p.path).sort()).toEqual([
			'interleave',
			'leechThreshold',
			'newPerDay'
		]);
	});

	it('refuses a setting that does not exist, naming it', () => {
		const problems = settingProblems({ newPerDay: 5, bogus: 1 });
		expect(problems).toEqual([
			{ path: 'bogus', code: 'unknown_field', message: expect.stringContaining('bogus') }
		]);
	});

	it('refuses something that is not a set of settings', () => {
		for (const value of [null, [], 'x', 5, true]) {
			expect(settingProblems(value)[0], JSON.stringify(value)).toMatchObject({ path: '' });
		}
	});

	it('does not echo what was sent in the message', () => {
		const nasty = '<script>alert(1)</script>';
		const text = JSON.stringify(settingProblems({ newPerDay: nasty, [nasty]: 1 }));
		expect(text).not.toContain('<script>');
	});

	it('agrees with the schema the database uses, for every setting (property test)', () => {
		const value = fc.oneof(
			fc.integer({ min: -5, max: 12_000 }),
			fc.double({ min: -1, max: 120, noNaN: true }),
			fc.boolean(),
			fc.string({ maxLength: 4 }),
			fc.constant(null)
		);
		fc.assert(
			fc.property(
				fc.constantFrom(...(Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[])),
				value,
				(key, candidate) => {
					const mine = settingProblems({ [key]: candidate }).length === 0;
					const theirs = SettingsSchema.shape[key].safeParse(candidate).success;
					expect(mine).toBe(theirs);
				}
			),
			{ numRuns: 1500 }
		);
	});
});
