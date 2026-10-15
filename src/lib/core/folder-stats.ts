import { nextRollover, studyDayKey, studyDayStart } from './study-day.ts';

// Pure helpers that turn a list of review times into per-day numbers and a streak for a folder's statistics.
// A "day" is a study day (it starts at the rollover hour, so a late session counts for the day it began).

export interface DayConfig {
	timeZone: string;
	rolloverHour: number;
}

export interface ReviewPoint {
	reviewedAt: string;
	grade: number;
	durationMs: number | null;
}

export interface DayTotals {
	day: string;
	reviews: number;
	remembered: number;
	timeMs: number;
}

// The study day that comes `delta` days from `key` ("2026-10-14" plus -1 is "2026-10-13"). Calendar arithmetic on the
// label only, so it does not depend on the length of a day.
export function shiftDayKey(key: string, delta: number): string {
	const [year, month, day] = key.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

// Gives the study day of an instant. Reviews usually come in runs, so the window of the last day found is kept and
// reused, which makes a few thousand reviews cost a few dozen time zone calculations.
export function dayKeyer(config: DayConfig): (iso: string) => string {
	let from = 0;
	let until = 0;
	let key = '';
	return (iso) => {
		const at = new Date(iso);
		const ms = at.getTime();
		if (ms < from || ms >= until || key === '') {
			from = studyDayStart(at, config.timeZone, config.rolloverHour).getTime();
			until = nextRollover(at, config.timeZone, config.rolloverHour).getTime();
			key = studyDayKey(at, config.timeZone, config.rolloverHour);
		}
		return key;
	};
}

// Totals for each of the last `length` study days, oldest first, today last. Reviews outside that range are ignored.
export function dailyTotals(
	points: ReviewPoint[],
	now: Date,
	config: DayConfig,
	length: number
): DayTotals[] {
	const today = studyDayKey(now, config.timeZone, config.rolloverHour);
	const days: DayTotals[] = [];
	for (let back = length - 1; back >= 0; back--) {
		days.push({ day: shiftDayKey(today, -back), reviews: 0, remembered: 0, timeMs: 0 });
	}
	const byDay = new Map(days.map((entry) => [entry.day, entry]));
	const keyOf = dayKeyer(config);
	for (const point of points) {
		const entry = byDay.get(keyOf(point.reviewedAt));
		if (!entry) continue;
		entry.reviews += 1;
		if (point.grade >= 2) entry.remembered += 1;
		entry.timeMs += point.durationMs ?? 0;
	}
	return days;
}

// Study days in a row with a review, counting back from today. When today has none yet, counting starts at yesterday,
// so a streak is not shown as broken until the day is over.
export function streakLength(
	points: ReviewPoint[],
	now: Date,
	config: DayConfig,
	maxDays: number
): number {
	const keyOf = dayKeyer(config);
	const studied = new Set<string>();
	for (const point of points) studied.add(keyOf(point.reviewedAt));
	let day = studyDayKey(now, config.timeZone, config.rolloverHour);
	if (!studied.has(day)) day = shiftDayKey(day, -1);
	let length = 0;
	while (length < maxDays && studied.has(day)) {
		length += 1;
		day = shiftDayKey(day, -1);
	}
	return length;
}
