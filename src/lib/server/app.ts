import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDataDir } from './boot-check.ts';
import { getConfig, type Config } from './config.ts';
import { systemClock, systemRng, type Clock, type Rng } from './clock.ts';
import { openDatabase, type Db, type DatabaseHandle } from './db/index.ts';
import { createLogger, type Logger } from './log.ts';

// Everything a request handler needs, created once at boot and passed down explicitly.
export interface AppContext {
	config: Config;
	log: Logger;
	clock: Clock;
	rng: Rng;
	database: DatabaseHandle;
	db: Db;
	version: string;
}

export interface CreateAppOptions {
	config?: Config;
	clock?: Clock;
	rng?: Rng;
	log?: Logger;
	migrationsFolder?: string;
}

function readVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version?: string };
		return pkg.version ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

// Builds a context without registering it globally. Tests use this directly.
export function createApp(options: CreateAppOptions = {}): AppContext {
	const config = options.config ?? getConfig();
	const clock = options.clock ?? systemClock;
	const log = options.log ?? createLogger({ level: config.logLevel, clock });
	checkDataDir(config.dataDir);
	const database = openDatabase({
		dataDir: config.dataDir,
		clock,
		log,
		...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {})
	});
	return {
		config,
		log,
		clock,
		rng: options.rng ?? systemRng,
		database,
		db: database.db,
		version: readVersion()
	};
}

let current: AppContext | undefined;

// Called once at server start. Fails fast with a readable message on bad configuration.
export function initApp(): AppContext {
	if (current) return current;
	current = createApp();
	if (process.env['NODE_ENV'] === 'production' && !process.env['BODY_SIZE_LIMIT']) {
		current.log.warn(
			'BODY_SIZE_LIMIT is not set. adapter-node then rejects request bodies over 512 KB, below the 5 MB import limit. Set BODY_SIZE_LIMIT=5M.'
		);
	}
	return current;
}

export function getApp(): AppContext {
	if (!current)
		throw new Error('The app is not initialized. initApp() runs in the server init hook.');
	return current;
}

export function closeApp(): void {
	if (!current) return;
	current.log.info('shutting down, closing the database');
	current.database.close();
	current = undefined;
}
