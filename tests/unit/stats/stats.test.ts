import { describe, expect, it } from 'vitest';
import type { DayConfig, ReviewPoint } from '#lib/core/folder-stats.ts';
import { forecast, heatLevel, heatmapWeeks, weekdayOf, type DueItem } from '#lib/core/stats.ts';

// The due forecast and the heatmap for the Statistics page. A study day starts at the rollover hour in the server's
// time zone, so these tests use America/Chicago (UTC-5 in October, UTC-6 from 2026-11-01) and a 4 am rollover.

const CHICAGO: DayConfig = { timeZone: 'America/Chicago', rolloverHour: 4 };

// A Chicago wall time in October 2026 (daylight time, UTC-5) as an ISO instant.
function at(day: number, hour: number, minute = 0): string {
	return new Date(Date.UTC(2026, 9, day, hour + 5, minute)).toISOString();
}

const NOW = new Date(at(14, 10)); // Wednesday 2026-10-14, 10:00 in Chicago

const due = (iso: string, phase = 2): DueItem => ({ due: iso, phase });
const point = (reviewedAt: string, grade = 3): ReviewPoint => ({
	reviewedAt,
	grade,
	durationMs: 1000
});

describe('weekdayOf', () => {
	it.each([
		['2026-10-12', 0],
		['2026-10-13', 1],
		['2026-10-14', 2],
		['2026-10-17', 5],
		['2026-10-18', 6],
		['2026-10-19', 0],
		['2024-02-29', 3]
	])('%s is weekday %d (Monday is 0)', (day, weekday) => {
		expect(weekdayOf(day)).toBe(weekday);
	});
});

describe('forecast', () => {
	it('lists the next days, today first, with every count at zero when nothing is due', () => {
		const result = forecast([], NOW, CHICAGO, 30);
		expect(result.overdue).toBe(0);
		expect(result.days).toHaveLength(30);
		expect(result.days[0]).toEqual({ day: '2026-10-14', due: 0 });
		expect(result.days[1]!.day).toBe('2026-10-15');
		expect(result.days[29]!.day).toBe('2026-11-12');
		expect(result.days.every((entry) => entry.due === 0)).toBe(true);
	});

	it('counts an item on the study day it falls due', () => {
		const result = forecast(
			[due(at(14, 15)), due(at(15, 9)), due(at(15, 22)), due(at(20, 3)), due(at(20, 3, 59))],
			NOW,
			CHICAGO,
			30
		);
		const byDay = Object.fromEntries(result.days.map((entry) => [entry.day, entry.due]));
		expect(byDay['2026-10-14']).toBe(1);
		expect(byDay['2026-10-15']).toBe(2);
		// 3:00 and 3:59 on the 20th are before the 4 am rollover, so they belong to the 19th.
		expect(byDay['2026-10-19']).toBe(2);
		expect(byDay['2026-10-20']).toBe(0);
	});

	it('uses the rollover hour for the edges of a day', () => {
		const result = forecast([due(at(15, 3, 59)), due(at(15, 4))], NOW, CHICAGO, 5);
		expect(result.days.map((entry) => entry.due)).toEqual([1, 1, 0, 0, 0]);
	});

	it('counts review items that were due before today as overdue, not on any day', () => {
		const result = forecast(
			[due(at(13, 20)), due(at(10, 8)), due(at(14, 3, 59))],
			NOW,
			CHICAGO,
			30
		);
		expect(result.overdue).toBe(3);
		expect(result.days.reduce((total, entry) => total + entry.due, 0)).toBe(0);
	});

	it('counts overdue learning and relearning items today, because a session shows them today', () => {
		const result = forecast(
			[due(at(13, 20), 1), due(at(12, 8), 3), due(at(14, 5), 1)],
			NOW,
			CHICAGO,
			30
		);
		expect(result.overdue).toBe(0);
		expect(result.days[0]!.due).toBe(3);
	});

	it('leaves out new items and items beyond the last day', () => {
		const result = forecast(
			[due(at(14, 12), 0), due(new Date(Date.UTC(2027, 5, 1)).toISOString())],
			NOW,
			CHICAGO,
			30
		);
		expect(result.overdue).toBe(0);
		expect(result.days.reduce((total, entry) => total + entry.due, 0)).toBe(0);
	});

	it('does not depend on the order the items are given in', () => {
		const items = [
			due(at(18, 9)),
			due(at(15, 9)),
			due(at(16, 9)),
			due(at(15, 20)),
			due(at(14, 11))
		];
		const forward = forecast(items, NOW, CHICAGO, 10);
		const backward = forecast([...items].reverse(), NOW, CHICAGO, 10);
		expect(backward).toEqual(forward);
	});

	it('keeps counting days correctly across the end of daylight saving time', () => {
		const days = forecast([], NOW, CHICAGO, 30).days.map((entry) => entry.day);
		expect(days).toContain('2026-11-01');
		expect(new Set(days).size).toBe(30);
	});
});

describe('heatmapWeeks', () => {
	it('is a calendar of Monday to Sunday columns that ends with today and blanks the days after it', () => {
		const weeks = heatmapWeeks([], NOW, CHICAGO, 3);
		expect(weeks).toHaveLength(3);
		expect(weeks.every((week) => week.length === 7)).toBe(true);
		expect(weeks[0]![0]!.day).toBe('2026-09-28');
		expect(weeks[2]![0]!.day).toBe('2026-10-12');
		expect(weeks[2]![2]!.day).toBe('2026-10-14');
		expect(weeks[2]!.slice(3)).toEqual([null, null, null, null]);
	});

	it('counts reviews on the study day they were made, late nights included', () => {
		const weeks = heatmapWeeks(
			[
				point(at(13, 9)),
				point(at(13, 22)),
				point(at(14, 1)), // 1 am on the 14th still belongs to the 13th
				point(at(14, 9)),
				point(at(8, 12))
			],
			NOW,
			CHICAGO,
			2
		);
		const cells = new Map(weeks.flat().flatMap((cell) => (cell ? [[cell.day, cell.reviews]] : [])));
		expect(cells.get('2026-10-13')).toBe(3);
		expect(cells.get('2026-10-14')).toBe(1);
		expect(cells.get('2026-10-08')).toBe(1);
		expect(cells.get('2026-10-12')).toBe(0);
	});

	it('ignores reviews before the first column', () => {
		const weeks = heatmapWeeks([point(at(1, 12))], NOW, CHICAGO, 2);
		expect(weeks.flat().reduce((total, cell) => total + (cell?.reviews ?? 0), 0)).toBe(0);
	});

	it('shows a full 26 weeks', () => {
		const weeks = heatmapWeeks([], NOW, CHICAGO, 26);
		expect(weeks).toHaveLength(26);
		expect(weeks[0]![0]!.day).toBe('2026-04-20');
	});
});

describe('heatLevel', () => {
	it('is 0 for no reviews and scales 1 to 4 against the busiest day', () => {
		expect(heatLevel(0, 100)).toBe(0);
		expect(heatLevel(5, 0)).toBe(0);
		expect(heatLevel(1, 100)).toBe(1);
		expect(heatLevel(25, 100)).toBe(1);
		expect(heatLevel(26, 100)).toBe(2);
		expect(heatLevel(50, 100)).toBe(2);
		expect(heatLevel(51, 100)).toBe(3);
		expect(heatLevel(75, 100)).toBe(3);
		expect(heatLevel(76, 100)).toBe(4);
		expect(heatLevel(100, 100)).toBe(4);
	});
});
