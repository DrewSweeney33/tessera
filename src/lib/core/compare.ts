// Orders two strings by their UTF-16 code units: the same order on every machine and in every locale, which
// localeCompare does not promise. For sort orders that are stored, hashed, or shown the same way everywhere.
export function compareText(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}
