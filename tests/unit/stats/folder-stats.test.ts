import { describe, expect, it } from 'vitest';
import {
	dailyTotals,
	dayKeyer,
	shiftDayKey,
	streakLength,
	type DayConfig,
	type ReviewPoint
} from '#lib/core/folder-stats.ts';

// The per-day numbers and the streak in a folder's statistics. A study day starts at the rollover hour in the
// server's time zone, so these tests use America/Chicago (UTC-5 in October, UTC-6 in winter) and a 4 am rollover.

const CHICAGO: DayConfig = { timeZone: 'America/Chicago', rolloverHour: 4 };

// A review at a Chicago wall time in October 2026 (daylight time, UTC-5).
function at(day: number, hour: number, minute = 0): string {
	return new Date(Date.UTC(2026, 9, day, hour + 5, minute)).toISOString();
}

const point = (reviewedAt: string, grade = 3, durationMs: number | null = 1000): ReviewPoint => ({
	reviewedAt,
	grade,
	durationMs
});

describe('shiftDayKey', () => {
	it.each([
		['2026-10-14', -1, '2026-10-13'],
		['2026-10-01', -1, '2026-09-30'],
		['2026-01-01', -1, '2025-12-31'],
		['2026-02-28', 1, '2026-03-01'],
		['2028-02-28', 1, '2028-02-29'],
		['2026-10-14', 0, '2026-10-14'],
		['2026-10-14', -30, '2026-09-14']
	])('%s shifted by %d is %s', (key, delta, shifted) => {
		expect(shiftDayKey(key, delta)).toBe(shifted);
	});
});

describe('dayKeyer', () => {
	it('puts a late-night review on the study day it belongs to', () => {
		const keyOf = dayKeyer(CHICAGO);
		expect(keyOf(at(14, 12))).toBe('2026-10-14');
		expect(keyOf(at(15, 1))).toBe('2026-10-14'); // 1 am is still the 14th's study day
		expect(keyOf(at(15, 3, 59))).toBe('2026-10-14');
		expect(keyOf(at(15, 4))).toBe('2026-10-15');
	});

	it('gives the same answers whatever order it is asked in', () => {
		const keyOf = dayKeyer(CHICAGO);
		const times = [at(14, 12), at(13, 12), at(14, 13), at(20, 9), at(13, 2)];
		const first = times.map(keyOf);
		const again = [...times].reverse().map(keyOf).reverse();
		expect(again).toEqual(first);
		expect(first).toEqual(['2026-10-14', '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-12']);
	});

	it('handles the day the clocks go back', () => {
		// Clocks go back at 2 am on 2026-11-01, so the study day of 2026-10-31 (4 am to 4 am) lasts 25 hours: it ends at
		// 10:00 UTC, not 09:00.
		const keyOf = dayKeyer(CHICAGO);
		expect(keyOf('2026-11-01T08:59:00.000Z')).toBe('2026-10-31');
		expect(keyOf('2026-11-01T09:59:00.000Z')).toBe('2026-10-31');
		expect(keyOf('2026-11-01T10:00:00.000Z')).toBe('2026-11-01');
		expect(keyOf('2026-11-02T09:59:00.000Z')).toBe('2026-11-01');
		expect(keyOf('2026-11-02T10:00:00.000Z')).toBe('2026-11-02');
	});
});

describe('dailyTotals', () => {
	const now = new Date(at(14, 15));

	it('lists the last days, oldest first, with today last, even when nothing happened', () => {
		const days = dailyTotals([], now, CHICAGO, 5);
		expect(days.map((d) => d.day)).toEqual([
			'2026-10-10',
			'2026-10-11',
			'2026-10-12',
			'2026-10-13',
			'2026-10-14'
		]);
		expect(days.every((d) => d.reviews === 0 && d.remembered === 0 && d.timeMs === 0)).toBe(true);
	});

	it('adds reviews, remembered reviews, and time to the right day', () => {
		const days = dailyTotals(
			[
				point(at(14, 9), 3, 2000),
				point(at(14, 10), 1, 4000),
				point(at(14, 11), 2, null),
				point(at(13, 22), 4, 1000),
				point(at(15, 1), 3, 500) // 1 am on the 15th is still the 14th's study day
			],
			now,
			CHICAGO,
			3
		);
		expect(days.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
		expect(days[2]).toEqual({ day: '2026-10-14', reviews: 4, remembered: 3, timeMs: 6500 });
		expect(days[1]).toEqual({ day: '2026-10-13', reviews: 1, remembered: 1, timeMs: 1000 });
		expect(days[0]!.reviews).toBe(0);
	});

	it('ignores reviews older than the range and ones after today', () => {
		const days = dailyTotals(
			[point(at(1, 12)), point(at(20, 12)), point(at(13, 12))],
			now,
			CHICAGO,
			3
		);
		expect(days.map((d) => d.reviews)).toEqual([0, 1, 0]);
	});
});

describe('streakLength', () => {
	const now = new Date(at(14, 15));
	const days = (...numbers: number[]) => numbers.map((day) => point(at(day, 12)));

	it('is zero with no reviews', () => {
		expect(streakLength([], now, CHICAGO, 400)).toBe(0);
	});

	it('counts the days in a row up to and including today', () => {
		expect(streakLength(days(12, 13, 14), now, CHICAGO, 400)).toBe(3);
	});

	it('does not break the streak while today has no review yet', () => {
		expect(streakLength(days(11, 12, 13), now, CHICAGO, 400)).toBe(3);
	});

	it('is zero when the last review was before yesterday', () => {
		expect(streakLength(days(10, 11), now, CHICAGO, 400)).toBe(0);
	});

	it('stops at a gap', () => {
		expect(streakLength(days(8, 9, 11, 12, 13, 14), now, CHICAGO, 400)).toBe(4);
	});

	it('counts many reviews in one day once, and a late-night review for the day it began', () => {
		// 1 am on the 14th belongs to the 13th, so the 13th has three reviews and the 14th (9 am now) has none yet.
		const late = [point(at(13, 12)), point(at(13, 13)), point(at(14, 1))];
		expect(streakLength(late, new Date(at(14, 9)), CHICAGO, 400)).toBe(1);
	});

	it('never counts more than the longest span it looks back over', () => {
		const run = Array.from({ length: 14 }, (_, i) => point(at(14 - i, 12)));
		expect(streakLength(run, now, CHICAGO, 5)).toBe(5);
	});
});
