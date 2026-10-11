import { err, ok, type Result } from '#lib/core/result.ts';
import {
	DEFAULT_SETTINGS,
	SETTING_KEYS,
	isSettingKey,
	validateSetting,
	type SettingKey,
	type Settings
} from '#lib/core/settings.ts';
import type { Executor } from '../db/client.ts';
import { settings } from '../db/schema.ts';

// Stored values are JSON. A missing, corrupt, or out-of-range value falls back to the default
// so a bad row can never stop the app from studying.
export function getSettings(x: Executor): Settings {
	const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
	for (const row of x.select().from(settings).all()) {
		if (!isSettingKey(row.key)) continue;
		try {
			const checked = validateSetting(row.key, JSON.parse(row.value));
			if (checked.ok) result[row.key] = checked.value;
		} catch {
			// keep the default
		}
	}
	return result as Settings;
}

export function getSetting<K extends SettingKey>(x: Executor, key: K): Settings[K] {
	return getSettings(x)[key];
}

export function setSetting<K extends SettingKey>(
	x: Executor,
	key: K,
	value: unknown
): Result<Settings[K], string> {
	const checked = validateSetting(key, value);
	if (!checked.ok) return err(checked.error);
	const json = JSON.stringify(checked.value);
	x.insert(settings)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json } })
		.run();
	return ok(checked.value);
}

export { SETTING_KEYS };
