import { systemClock, type Clock } from './clock.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface Logger {
	debug(msg: string, fields?: Record<string, unknown>): void;
	info(msg: string, fields?: Record<string, unknown>): void;
	warn(msg: string, fields?: Record<string, unknown>): void;
	error(msg: string, fields?: Record<string, unknown>): void;
	child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
	level: LogLevel;
	write?: (line: string) => void;
	clock?: Clock;
	fields?: Record<string, unknown>;
}

// Card content, typed answers, and credentials must never reach the logs (ADR-005).
const REDACTED_KEYS = new Set([
	'token',
	'apitoken',
	'authorization',
	'password',
	'typedanswer',
	'content',
	'front',
	'back',
	'text',
	'answer',
	'hint',
	'explanation'
]);

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function redact(fields: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : value;
	}
	return out;
}

export function createLogger(options: LoggerOptions): Logger {
	const write = options.write ?? ((line: string) => process.stdout.write(line + '\n'));
	const clock = options.clock ?? systemClock;
	const base = options.fields ?? {};

	const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
		if (rank[level] < rank[options.level]) return;
		write(
			JSON.stringify({
				time: clock.now().toISOString(),
				level,
				msg,
				...redact(base),
				...redact(fields ?? {})
			})
		);
	};

	return {
		debug: (msg, fields) => emit('debug', msg, fields),
		info: (msg, fields) => emit('info', msg, fields),
		warn: (msg, fields) => emit('warn', msg, fields),
		error: (msg, fields) => emit('error', msg, fields),
		child: (fields) => createLogger({ ...options, fields: { ...base, ...fields } })
	};
}
