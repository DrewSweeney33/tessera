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
