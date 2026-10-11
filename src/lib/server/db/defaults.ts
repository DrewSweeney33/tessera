import type { Sqlite } from './client.ts';

// User-facing settings and their defaults (architect decisions section 5, ADR-003).
export const DEFAULT_SETTINGS = {
	target_retention: 0.9,
	new_per_day: 20,
	reviews_per_day: 200,
	rollover_hour: 4,
	leech_threshold: 8,
	interleave: false
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

// Inserts any missing defaults and never overwrites a value the user changed.
export function seedSettings(sqlite: Sqlite): void {
	const insert = sqlite.prepare('insert or ignore into settings (key, value) values (?, ?)');
	const seed = sqlite.transaction(() => {
		for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
			insert.run(key, JSON.stringify(value));
		}
	});
	seed();
}
