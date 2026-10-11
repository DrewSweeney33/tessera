import { z } from 'zod';
import { err, ok, type Result } from '#lib/core/result.ts';
import { LOG_LEVELS, type LogLevel } from './log.ts';

export interface Config {
	readonly port: number;
	readonly dataDir: string;
	readonly apiToken: string | undefined;
	readonly allowedHosts: readonly string[] | undefined;
	readonly timeZone: string;
	readonly logLevel: LogLevel;
	readonly origin: string | undefined;
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
	TESSERA_ALLOWED_HOSTS: z.preprocess(blank, z.string().optional()),
	TZ: z.preprocess(
		blank,
		z.string().default('UTC').refine(isValidTimeZone, {
			message: 'is not a valid IANA time zone, for example UTC or America/Chicago'
		})
	),
	LOG_LEVEL: z.preprocess(blank, z.enum(LOG_LEVELS).default('info')),
	ORIGIN: z.preprocess(
		blank,
		z.url({ message: 'must be a full URL such as https://tessera.example.com' }).optional()
	)
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
			allowedHosts: hosts && hosts.length > 0 ? Object.freeze(hosts) : undefined,
			timeZone: e.TZ,
			logLevel: e.LOG_LEVEL,
			origin: e.ORIGIN
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
