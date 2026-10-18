import { z } from 'zod';
import { err, ok, type Result } from '#lib/core/result.ts';
import { LOG_LEVELS, type LogLevel } from './log.ts';

export interface Config {
	readonly port: number;
	readonly dataDir: string;
	readonly apiToken: string | undefined;
	// The page password (ADR-021). Undefined means sign-in is off.
	readonly password: string | undefined;
	// The most backups of kind manual that Back up now will make before it asks for one to be deleted.
	readonly maxBackups: number;
	readonly allowedHosts: readonly string[] | undefined;
	readonly timeZone: string;
	readonly logLevel: LogLevel;
}

// A blank environment variable (VAR=) counts as unset.
const blank = (value: unknown) =>
	typeof value === 'string' && value.trim() === '' ? undefined : value;

function isValidTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

const EnvSchema = z.object({
	PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).default(3000)),
	DATA_DIR: z.preprocess(blank, z.string().default('./data')),
	TESSERA_API_TOKEN: z.preprocess(
		blank,
		z
			.string()
			.min(24, 'must be at least 24 characters (generate one with: openssl rand -hex 32)')
			.optional()
	),
	TESSERA_PASSWORD: z.preprocess(
		blank,
		z
			.string()
			.min(
				12,
				'must be at least 12 characters (a generated one is best, keep it in a password manager)'
			)
			.max(200, 'must be at most 200 characters')
			.optional()
	),
	TESSERA_MAX_BACKUPS: z.preprocess(blank, z.coerce.number().int().min(1).max(1000).default(10)),
	TESSERA_ALLOWED_HOSTS: z.preprocess(blank, z.string().optional()),
	TZ: z.preprocess(
		blank,
		z.string().default('UTC').refine(isValidTimeZone, {
			message: 'is not a valid IANA time zone, for example UTC or America/Chicago'
		})
	),
	LOG_LEVEL: z.preprocess(blank, z.enum(LOG_LEVELS).default('info'))
});

export function parseConfig(env: Record<string, string | undefined>): Result<Config, string[]> {
	const parsed = EnvSchema.safeParse(env);
	if (!parsed.success) {
		return err(
			parsed.error.issues.map(
				(issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`
			)
		);
	}
	const e = parsed.data;
	const hosts = e.TESSERA_ALLOWED_HOSTS?.split(',')
		.map((h) => h.trim().toLowerCase())
		.filter((h) => h.length > 0);
	return ok(
		Object.freeze({
			port: e.PORT,
			dataDir: e.DATA_DIR,
			apiToken: e.TESSERA_API_TOKEN,
			password: e.TESSERA_PASSWORD,
			maxBackups: e.TESSERA_MAX_BACKUPS,
			allowedHosts: hosts && hosts.length > 0 ? Object.freeze(hosts) : undefined,
			timeZone: e.TZ,
			logLevel: e.LOG_LEVEL
		})
	);
}

export class ConfigError extends Error {
	readonly problems: string[];

	constructor(problems: string[]) {
		super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
		this.name = 'ConfigError';
		this.problems = problems;
	}
}

let cached: Config | undefined;

// Read once at boot, validated, frozen. Throws ConfigError with a readable message when invalid.
export function getConfig(): Config {
	if (cached) return cached;
	const result = parseConfig(process.env);
	if (!result.ok) throw new ConfigError(result.error);
	cached = result.value;
	return cached;
}
