import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDataDir } from './boot-check.ts';
import { getConfig, type Config } from './config.ts';
import { systemClock, systemRng, type Clock, type Rng } from './clock.ts';
import { openDatabase, type Db, type DatabaseHandle } from './db/index.ts';
import { createLogger, type Logger } from './log.ts';
import { applyPendingRestore } from './restore/index.ts';

// Everything a request handler needs, created once at boot and passed down explicitly.
export interface AppContext {
	config: Config;
	log: Logger;
	clock: Clock;
	rng: Rng;
	database: DatabaseHandle;
	db: Db;
	version: string;
	// Asks the process to stop cleanly, after a restore has been staged. A supervisor (the restart policy) then
	// starts it again, and the restore is applied before the database is opened.
	requestShutdown: () => void;
}

export interface CreateAppOptions {
	config?: Config;
	clock?: Clock;
	rng?: Rng;
	log?: Logger;
	migrationsFolder?: string;
	requestShutdown?: () => void;
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
	// A restore chosen on the Backups page is applied here, before the database is opened (ADR-014).
	const restore = applyPendingRestore(config.dataDir, clock, {}, options.migrationsFolder);
	if (restore?.ok) log.info('restore applied', { backup: restore.name, keptAs: restore.keptAs });
	else if (restore) log.error('restore could not be done', { reason: restore.message });
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
		version: readVersion(),
		requestShutdown:
			options.requestShutdown ??
			(() => {
				// A moment first, so the answer that asked for this reaches the browser.
				setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800);
			})
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
	// ADR-005 section 1: say which host names are answered, so a 421 later is no surprise.
	const hosts = current.config.allowedHosts;
	current.log.info(
		hosts
			? 'host check: answering only the listed host names, plus localhost and IP addresses'
			: 'host check: using the default rules. Answering localhost, IP addresses, single-word names, and names ending in .local, .lan, .home.arpa, .internal, or .localdomain. If you reach Tessera by any other name, for example through a reverse proxy, set TESSERA_ALLOWED_HOSTS.',
		hosts ? { hosts: [...hosts] } : {}
	);
	if (current.config.apiToken !== undefined) {
		current.log.info(
			'API token: set. Requests to /api/* from outside the Tessera web page need Authorization: Bearer. The web page itself is not protected by the token, so keep it behind a VPN or a reverse proxy that asks for a password.'
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
