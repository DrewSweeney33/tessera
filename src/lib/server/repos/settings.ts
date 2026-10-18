import { eq } from 'drizzle-orm';
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

// The sign-in counter (ADR-021). It is not a user-facing setting, so it is read and written here and never goes through
// the settings validation. Sign out everywhere raises it, and a login cookie made under an older value is refused.
const SESSION_EPOCH_KEY = 'auth.sessionEpoch';

export function getSessionEpoch(x: Executor): number {
	const row = x.select().from(settings).where(eq(settings.key, SESSION_EPOCH_KEY)).get();
	if (!row) return 0;
	try {
		const value: unknown = JSON.parse(row.value);
		return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e9
			? value
			: 0;
	} catch {
		return 0;
	}
}

export function bumpSessionEpoch(x: Executor): number {
	const next = getSessionEpoch(x) + 1;
	const json = JSON.stringify(next);
	x.insert(settings)
		.values({ key: SESSION_EPOCH_KEY, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json } })
		.run();
	return next;
}

export { SETTING_KEYS };
