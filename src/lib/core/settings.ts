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

export interface SettingProblem {
	// The setting, or "" when what was sent is not a set of settings at all.
	path: string;
	code: 'wrong_type' | 'out_of_range' | 'unknown_field' | 'not_an_object';
	message: string;
}

// What each setting accepts, in words a person can act on. The form and the server show these.
export const SETTING_MESSAGES: Record<SettingKey, string> = {
	newPerDay: 'New cards per day must be a whole number from 0 to 1000.',
	reviewsPerDay: 'Reviews per day must be a whole number from 0 to 10000.',
	targetRetention: 'Target retention must be between 70% and 99% (0.7 to 0.99).',
	rolloverHour: 'The hour the study day starts must be a whole number from 0 to 23.',
	leechThreshold: 'The leech threshold must be a whole number from 2 to 100.',
	interleave: 'Mixing new and review cards must be on or off.'
};

// Everything wrong with a change to the settings, so a form can show each beside its field. An empty list means every
// value sent is acceptable (an empty change is acceptable too; whether to save nothing is for the caller to say). It
// never repeats what was sent, except the name of an unknown setting that looks like a plain name.
export function settingProblems(input: unknown): SettingProblem[] {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return [
			{
				path: '',
				code: 'not_an_object',
				message: 'Send the settings as a JSON object, for example {"newPerDay": 10}.'
			}
		];
	}
	const problems: SettingProblem[] = [];
	for (const [key, value] of Object.entries(input)) {
		if (!isSettingKey(key)) {
			const plain = /^[A-Za-z0-9_]{1,40}$/.test(key);
			problems.push({
				path: plain ? key : '',
				code: 'unknown_field',
				message: plain ? `There is no setting called "${key}".` : 'There is no such setting.'
			});
			continue;
		}
		if (!SettingsSchema.shape[key].safeParse(value).success) {
			problems.push({
				path: key,
				code: typeof value === typeof DEFAULT_SETTINGS[key] ? 'out_of_range' : 'wrong_type',
				message: SETTING_MESSAGES[key]
			});
		}
	}
	return problems;
}
