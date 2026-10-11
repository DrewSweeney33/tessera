// The "study day" starts at a rollover hour in a time zone, not at midnight (default 4am), so a
// late-night session still counts as the same day. Daily limits, burying, and streaks all use it.
// Pure: it never reads the clock, and uses only Intl for time zone rules, so DST is handled by the
// platform's tz database.

interface WallTime {
	year: number;
	month: number; // 1 to 12
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let cached = formatters.get(timeZone);
	if (!cached) {
		// Throws RangeError for an unknown zone, which config validation should prevent.
		cached = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(timeZone, cached);
	}
	return cached;
}

// The wall clock reading in `timeZone` at the instant `date`.
function wallTime(date: Date, timeZone: string): WallTime {
	const out: Record<string, number> = {};
	for (const part of formatter(timeZone).formatToParts(date)) {
		if (part.type !== 'literal') out[part.type] = Number(part.value);
	}
	return {
		year: out['year']!,
		month: out['month']!,
		day: out['day']!,
		hour: out['hour']!,
		minute: out['minute']!,
		second: out['second']!
	};
}

function sameWall(a: WallTime, b: WallTime): boolean {
	return (
		a.year === b.year &&
		a.month === b.month &&
		a.day === b.day &&
		a.hour === b.hour &&
		a.minute === b.minute &&
		a.second === b.second
	);
}

// The instant at which the wall clock in `timeZone` reads year-month-day hour:00.
// A wall time that happens twice (clocks go back) resolves to the first occurrence.
// One that never happens (clocks go forward) resolves to the first valid instant after the gap.
function wallToInstant(
	year: number,
	month: number,
	day: number,
	hour: number,
	timeZone: string
): Date {
	const target: WallTime = { year, month, day, hour, minute: 0, second: 0 };
	// Treat the wall time as UTC, then correct by the zone's offset at nearby instants.
	const asUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
	const offsetAt = (ms: number) => {
		const w = wallTime(new Date(ms), timeZone);
		return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - ms;
	};

	// The offset can differ on either side of a transition, so try both and keep the ones that fit.
	const before = asUtc - offsetAt(asUtc - 24 * 3_600_000);
	const after = asUtc - offsetAt(asUtc + 24 * 3_600_000);
	const candidates = [before, after].sort((a, b) => a - b);
	for (const ms of candidates) {
		if (sameWall(wallTime(new Date(ms), timeZone), target)) return new Date(ms);
	}
	// No instant has this wall reading: it falls in a spring-forward gap. Use the later candidate,
	// which is the first valid time after the gap.
	return new Date(candidates[candidates.length - 1]!);
}

function assertRolloverHour(hour: number): void {
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
		throw new RangeError(`rolloverHour must be a whole number from 0 to 23, got ${hour}.`);
	}
}

// The local calendar date on which the study day containing `now` began.
function startDate(
	now: Date,
	timeZone: string,
	rolloverHour: number
): { year: number; month: number; day: number } {
	const w = wallTime(now, timeZone);
	if (w.hour >= rolloverHour) return { year: w.year, month: w.month, day: w.day };
	const previous = new Date(Date.UTC(w.year, w.month - 1, w.day - 1));
	return {
		year: previous.getUTCFullYear(),
		month: previous.getUTCMonth() + 1,
		day: previous.getUTCDate()
	};
}

// The instant the current study day began (the most recent rollover at or before `now`).
export function studyDayStart(now: Date, timeZone: string, rolloverHour: number): Date {
	assertRolloverHour(rolloverHour);
	const d = startDate(now, timeZone, rolloverHour);
	return wallToInstant(d.year, d.month, d.day, rolloverHour, timeZone);
}

// The instant the next study day begins. Days are 23 or 25 hours long across DST changes.
export function nextRollover(now: Date, timeZone: string, rolloverHour: number): Date {
	assertRolloverHour(rolloverHour);
	const d = startDate(now, timeZone, rolloverHour);
	const next = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
	return wallToInstant(
		next.getUTCFullYear(),
		next.getUTCMonth() + 1,
		next.getUTCDate(),
		rolloverHour,
		timeZone
	);
}

// The study day as a label such as "2026-10-10": the local date on which it began.
export function studyDayKey(now: Date, timeZone: string, rolloverHour: number): string {
	assertRolloverHour(rolloverHour);
	const d = startDate(now, timeZone, rolloverHour);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}
