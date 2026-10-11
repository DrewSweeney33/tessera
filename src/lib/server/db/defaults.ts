import { DEFAULT_SETTINGS } from '#lib/core/settings.ts';
import type { Sqlite } from './client.ts';

// Inserts any missing defaults and never overwrites a value the user changed.
export function seedSettings(sqlite: Sqlite): void {
	const insert = sqlite.prepare('insert or ignore into settings (key, value) values (?, ?)');
	const seed = sqlite.transaction(() => {
		for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
			insert.run(key, JSON.stringify(value));
		}
	});
	// Immediate for the same reason as withTx: another process may be starting or writing.
	seed.immediate();
}
