import { z } from 'zod';
import { err, ok, type Result } from './result.ts';

// User-facing settings (ADR-003). The same schema validates the settings form and the database.
export const SettingsSchema = z.strictObject({
	targetRetention: z.number().min(0.7).max(0.99),
	newPerDay: z.number().int().min(0).max(1000),
	reviewsPerDay: z.number().int().min(0).max(10_000),
	rolloverHour: z.number().int().min(0).max(23),
	leechThreshold: z.number().int().min(2).max(100),
	interleave: z.boolean()
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
	targetRetention: 0.9,
	newPerDay: 20,
	reviewsPerDay: 200,
	rolloverHour: 4,
	leechThreshold: 8,
	interleave: false
});

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
	return (SETTING_KEYS as string[]).includes(key);
}

export function validateSetting<K extends SettingKey>(
	key: K,
	value: unknown
): Result<Settings[K], string> {
	const parsed = SettingsSchema.shape[key].safeParse(value);
	return parsed.success
		? ok(parsed.data as Settings[K])
		: err(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`);
}
