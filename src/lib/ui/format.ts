// A moment for a person, in their own locale: "Oct 12, 2026, 3:40 PM".
export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

// A file size for a person: 1.5 kB, 55.0 MB. Decimal units, as disks and downloads count them. Whole bytes below
// 1000. A size that rounds up to 1000.0 moves to the next unit, so nothing reads "1000.0 kB".
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
	if (bytes < 1000) return `${Math.round(bytes)} B`;
	let unit = 0;
	let value = bytes;
	while (value >= 1000 && unit < UNITS.length - 1) {
		value /= 1000;
		unit++;
	}
	if (value.toFixed(1) === '1000.0' && unit < UNITS.length - 1) {
		value /= 1000;
		unit++;
	}
	return `${value.toFixed(1)} ${UNITS[unit]}`;
}

// Time spent studying, for a person: "45 s", "12 min", "1 h 05 min". Whole minutes above a minute.
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '0 min';
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// A share from 0 to 1 as a whole percent: "91%". "No data" when there is nothing to measure.
export function formatPercent(share: number | null): string {
	return share === null ? 'No data' : `${Math.round(share * 100)}%`;
}

// A calendar day such as "2026-12-15" as "Dec 15, 2026". The label is a date, not a moment, so no time zone applies.
export function formatExamDate(day: string): string {
	const [year, month, date] = day.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
}
