import { describe, expect, it } from 'vitest';
import { nextRollover, studyDayKey, studyDayStart } from '#lib/core/study-day.ts';

// America/Chicago in 2026: UTC-6 (CST) in winter, UTC-5 (CDT) in summer.
// Clocks go forward Sun 2026-03-08 at 02:00 CST (08:00Z) and back Sun 2026-11-01 at 02:00 CDT (07:00Z).
const CHI = 'America/Chicago';
const HOUR = 3_600_000;

const d = (iso: string) => new Date(iso);
const start = (now: string, tz = CHI, hour = 4) => studyDayStart(d(now), tz, hour).toISOString();
const next = (now: string, tz = CHI, hour = 4) => nextRollover(d(now), tz, hour).toISOString();

describe('study day boundaries (America/Chicago, rollover 4am)', () => {
	it('starts at 4am local in summer (UTC-5)', () => {
		expect(start('2026-10-10T12:00:00Z')).toBe('2026-10-10T09:00:00.000Z');
		expect(next('2026-10-10T12:00:00Z')).toBe('2026-10-11T09:00:00.000Z');
	});

	it('belongs to the previous day before the rollover', () => {
		expect(start('2026-10-10T08:30:00Z')).toBe('2026-10-09T09:00:00.000Z');
		expect(next('2026-10-10T08:30:00Z')).toBe('2026-10-10T09:00:00.000Z');
	});

	it('starts a new day exactly at the rollover instant, and not one millisecond earlier', () => {
		expect(start('2026-10-10T09:00:00.000Z')).toBe('2026-10-10T09:00:00.000Z');
		expect(start('2026-10-10T08:59:59.999Z')).toBe('2026-10-09T09:00:00.000Z');
	});

	it('starts at 4am local in winter (UTC-6)', () => {
		expect(start('2026-01-15T12:00:00Z')).toBe('2026-01-15T10:00:00.000Z');
	});

	it('is 23 hours long when clocks go forward', () => {
		const dayStart = start('2026-03-07T12:00:00Z');
		const dayEnd = next('2026-03-07T12:00:00Z');
		expect(dayStart).toBe('2026-03-07T10:00:00.000Z'); // 4am CST
		expect(dayEnd).toBe('2026-03-08T09:00:00.000Z'); // 4am CDT
		expect((d(dayEnd).getTime() - d(dayStart).getTime()) / HOUR).toBe(23);
	});

	it('is 25 hours long when clocks go back', () => {
		const dayStart = start('2026-10-31T12:00:00Z');
		const dayEnd = next('2026-10-31T12:00:00Z');
		expect(dayStart).toBe('2026-10-31T09:00:00.000Z'); // 4am CDT
		expect(dayEnd).toBe('2026-11-01T10:00:00.000Z'); // 4am CST
		expect((d(dayEnd).getTime() - d(dayStart).getTime()) / HOUR).toBe(25);
	});
});

describe('rollover hours that fall in a DST change', () => {
	it('uses the first valid time after the gap when the rollover hour does not exist', () => {
		// 02:00 on 2026-03-08 never happens in Chicago. The day starts at 03:00 CDT (08:00Z).
		expect(start('2026-03-08T12:00:00Z', CHI, 2)).toBe('2026-03-08T08:00:00.000Z');
		expect(start('2026-03-08T09:00:00Z', CHI, 2)).toBe('2026-03-08T08:00:00.000Z');
		// 01:30 CST is before the gap, so it still belongs to the previous day (started 02:00 CST on the 7th).
		expect(start('2026-03-08T07:30:00Z', CHI, 2)).toBe('2026-03-07T08:00:00.000Z');
	});

	it('uses the first occurrence when the rollover hour happens twice', () => {
		// 01:00 happens at 06:00Z (CDT) and again at 07:00Z (CST) on 2026-11-01.
		expect(start('2026-11-01T08:00:00Z', CHI, 1)).toBe('2026-11-01T06:00:00.000Z');
		expect(start('2026-11-01T06:30:00Z', CHI, 1)).toBe('2026-11-01T06:00:00.000Z');
		// The second 01:30 (CST) is still inside the same study day, not a new one.
		expect(start('2026-11-01T07:30:00Z', CHI, 1)).toBe('2026-11-01T06:00:00.000Z');
		expect(start('2026-11-01T05:30:00Z', CHI, 1)).toBe('2026-10-31T06:00:00.000Z');
		expect(next('2026-11-01T08:00:00Z', CHI, 1)).toBe('2026-11-02T07:00:00.000Z');
	});
});

describe('other zones and hours', () => {
	it('works in UTC', () => {
		expect(start('2026-10-10T03:59:59Z', 'UTC')).toBe('2026-10-09T04:00:00.000Z');
		expect(start('2026-10-10T04:00:00Z', 'UTC')).toBe('2026-10-10T04:00:00.000Z');
	});

	it('works in a zone with a half-hour offset', () => {
		// 00:00Z is 05:30 in Asia/Kolkata (UTC+5:30), so the day began at 04:00 IST the same date.
		expect(start('2026-10-10T00:00:00Z', 'Asia/Kolkata')).toBe('2026-10-09T22:30:00.000Z');
	});

	it('supports a midnight rollover and a late-evening rollover', () => {
		expect(start('2026-10-10T12:00:00Z', CHI, 0)).toBe('2026-10-10T05:00:00.000Z');
		expect(start('2026-10-10T12:00:00Z', CHI, 23)).toBe('2026-10-10T04:00:00.000Z');
	});
});

describe('studyDayKey', () => {
	it('names the day by the local date it began on', () => {
		expect(studyDayKey(d('2026-10-10T12:00:00Z'), CHI, 4)).toBe('2026-10-10');
		expect(studyDayKey(d('2026-10-10T08:30:00Z'), CHI, 4)).toBe('2026-10-09');
		expect(studyDayKey(d('2026-01-01T04:30:00Z'), 'UTC', 5)).toBe('2025-12-31');
	});
});

describe('validation', () => {
	it('rejects an invalid rollover hour', () => {
		for (const hour of [-1, 24, 1.5, Number.NaN]) {
			expect(() => studyDayStart(d('2026-10-10T12:00:00Z'), CHI, hour)).toThrow(RangeError);
			expect(() => nextRollover(d('2026-10-10T12:00:00Z'), CHI, hour)).toThrow(RangeError);
			expect(() => studyDayKey(d('2026-10-10T12:00:00Z'), CHI, hour)).toThrow(RangeError);
		}
	});

	it('rejects an unknown time zone', () => {
		expect(() => studyDayStart(d('2026-10-10T12:00:00Z'), 'Mars/Olympus', 4)).toThrow(RangeError);
	});
});

// For sampled instants across two years, the study day must contain the instant, be 23 to 25 hours
// long, and chain to the next day without gaps or overlaps. A coarse sweep covers the whole range
// and dense sampling covers each DST transition, where the bugs would hide.
describe('invariants across two years of DST changes', () => {
	const zones = ['America/Chicago', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata'];
	// 1 is a gap hour in London, 2 is a gap hour in Chicago and Sydney.
	const hours = [0, 1, 2, 4];
	const from = Date.parse('2026-01-01T00:00:00Z');
	const to = Date.parse('2027-12-31T00:00:00Z');

	const offsetFormats = new Map<string, Intl.DateTimeFormat>();
	function offsetLabel(zone: string, ms: number): string {
		let format = offsetFormats.get(zone);
		if (!format) {
			format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
			offsetFormats.set(zone, format);
		}
		return format.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')!.value;
	}

	function sampleInstants(zone: string): number[] {
		const instants: number[] = [];
		for (let t = from; t < to; t += 19 * HOUR + 37 * 60_000) instants.push(t);
		// Find each offset change by looking at 12 hour steps, then sample densely around it.
		for (let t = from + 12 * HOUR; t < to; t += 12 * HOUR) {
			if (offsetLabel(zone, t - 12 * HOUR) !== offsetLabel(zone, t)) {
				for (let u = t - 18 * HOUR; u <= t + 6 * HOUR; u += 9 * 60_000) instants.push(u);
			}
		}
		return instants;
	}

	for (const zone of zones) {
		const instants = sampleInstants(zone);
		for (const hour of hours) {
			it(`${zone}, rollover ${hour}:00 (${instants.length} samples)`, () => {
				for (const t of instants) {
					const now = new Date(t);
					const s = studyDayStart(now, zone, hour);
					const n = nextRollover(now, zone, hour);
					const where = `${now.toISOString()} in [${s.toISOString()}, ${n.toISOString()})`;

					expect(s.getTime() <= t && t < n.getTime(), where).toBe(true);
					const length = (n.getTime() - s.getTime()) / HOUR;
					expect(length >= 22.9 && length <= 25.1, `${length}h, ${where}`).toBe(true);
					// The next day starts exactly where this one ends, and this one starts exactly at its start.
					expect(studyDayStart(n, zone, hour).getTime(), where).toBe(n.getTime());
					expect(studyDayStart(new Date(n.getTime() - 1), zone, hour).getTime(), where).toBe(
						s.getTime()
					);
				}
			});
		}
	}

	it('finds the DST transitions it is supposed to stress', () => {
		const transitions = (zone: string) => {
			let count = 0;
			for (let t = from + 12 * HOUR; t < to; t += 12 * HOUR) {
				if (offsetLabel(zone, t - 12 * HOUR) !== offsetLabel(zone, t)) count++;
			}
			return count;
		};
		expect(transitions('America/Chicago')).toBe(4);
		expect(transitions('Europe/London')).toBe(4);
		expect(transitions('Australia/Sydney')).toBe(4);
		expect(transitions('Asia/Kolkata')).toBe(0);
	});
});
