const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// One decimal, without a trailing ".0".
function tidy(value: number): string {
	return String(Math.round(value * 10) / 10);
}

// A short label for how far away `to` is from `from`, for the grade buttons: "<1m", "10m", "3h",
// "4d", "1.2mo", "1.5y". Always rounded for display, not for scheduling.
export function formatInterval(from: Date, to: Date): string {
	const ms = Math.max(0, to.getTime() - from.getTime());
	if (ms < MINUTE) return '<1m';
	if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
	if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
	const days = ms / DAY;
	if (days < 30) return `${Math.round(days)}d`;
	if (days < 365) return `${tidy(days / 30)}mo`;
	return `${tidy(days / 365)}y`;
}
