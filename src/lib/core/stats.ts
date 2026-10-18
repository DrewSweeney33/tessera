import { dayKeyer, shiftDayKey, type DayConfig, type ReviewPoint } from './folder-stats.ts';
import { studyDayKey, studyDayStart } from './study-day.ts';

// Pure helpers for the statistics page (ADR-017): the due forecast and the review heatmap. Like the folder statistics
// they work in study days (a day starts at the rollover hour), never calendar midnight.

// A day of the week for a study day label, 0 for Monday to 6 for Sunday. The label is a calendar date.
export function weekdayOf(day: string): number {
	const [year, month, date] = day.split('-').map(Number) as [number, number, number];
	return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

export interface DueItem {
	// When the item is due, as an ISO time.
	due: string;
	// 0 new, 1 learning, 2 review, 3 relearning. New items are not forecast, they are not scheduled yet.
	phase: number;
}

export interface ForecastDay {
	day: string;
	due: number;
}

export interface Forecast {
	// Review items whose due time passed before today began. They are waiting now.
	overdue: number;
	// The next study days, today first, with how many items fall due on each. Learning items due now or earlier are
	// counted today, because they are shown today.
	days: ForecastDay[];
}

// How many items fall due on each of the next `length` study days. Items due later than that are left out.
export function forecast(
	items: readonly DueItem[],
	now: Date,
	config: DayConfig,
	length: number
): Forecast {
	const todayStart = studyDayStart(now, config.timeZone, config.rolloverHour).getTime();
	const today = studyDayKey(now, config.timeZone, config.rolloverHour);
	const days: ForecastDay[] = [];
	for (let ahead = 0; ahead < length; ahead++) {
		days.push({ day: shiftDayKey(today, ahead), due: 0 });
	}
	const byDay = new Map(days.map((entry) => [entry.day, entry]));
	const keyOf = dayKeyer(config);
	let overdue = 0;
	// The keyer reuses the window of the last day it saw, so feed it in time order.
	const ordered = [...items]
		.filter((item) => item.phase !== 0)
		.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
	for (const item of ordered) {
		const at = new Date(item.due).getTime();
		if (at < todayStart) {
			if (item.phase === 2) overdue += 1;
			else days[0]!.due += 1;
			continue;
		}
		const entry = byDay.get(keyOf(item.due));
		if (entry) entry.due += 1;
	}
	return { overdue, days };
}

export interface HeatCell {
	day: string;
	reviews: number;
}

// Reviews per study day laid out as a calendar: `weeks` columns, oldest first, each with seven rows from Monday to
// Sunday. The last column ends with today; days after today and days before the first column are null.
export function heatmapWeeks(
	points: readonly ReviewPoint[],
	now: Date,
	config: DayConfig,
	weeks: number
): (HeatCell | null)[][] {
	const today = studyDayKey(now, config.timeZone, config.rolloverHour);
	const lastMonday = shiftDayKey(today, -weekdayOf(today));
	const firstMonday = shiftDayKey(lastMonday, -7 * (weeks - 1));
	const counts = new Map<string, number>();
	const keyOf = dayKeyer(config);
	for (const point of points) {
		const day = keyOf(point.reviewedAt);
		if (day >= firstMonday && day <= today) counts.set(day, (counts.get(day) ?? 0) + 1);
	}
	const columns: (HeatCell | null)[][] = [];
	for (let week = 0; week < weeks; week++) {
		const column: (HeatCell | null)[] = [];
		for (let row = 0; row < 7; row++) {
			const day = shiftDayKey(firstMonday, week * 7 + row);
			column.push(day > today ? null : { day, reviews: counts.get(day) ?? 0 });
		}
		columns.push(column);
	}
	return columns;
}

// A level from 0 to 4 for a day's reviews, relative to the busiest day shown, so the colours stay readable whether
// someone does 10 reviews a day or 400. 0 is no reviews.
export function heatLevel(reviews: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
	if (reviews <= 0 || busiest <= 0) return 0;
	const share = reviews / busiest;
	if (share <= 0.25) return 1;
	if (share <= 0.5) return 2;
	if (share <= 0.75) return 3;
	return 4;
}
