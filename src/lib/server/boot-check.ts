import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class DataDirError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'DataDirError';
	}
}

// A bind-mounted data directory owned by another user is the most common first-run failure in
// Docker. Fail at boot with a message that says exactly how to fix it, not a SQLite error later.
export function checkDataDir(dataDir: string): void {
	const absolute = resolve(dataDir);
	const probe = join(absolute, `.write-check-${process.pid}`);
	try {
		mkdirSync(absolute, { recursive: true });
		writeFileSync(probe, 'ok');
		rmSync(probe);
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code ?? 'unknown error';
		const uid = process.getuid?.();
		const gid = process.getgid?.();
		const who = uid === undefined ? 'the current user' : `user id ${uid}`;
		const fix =
			uid === undefined
				? 'Make the directory writable by that user.'
				: `Make it writable by that user, for example: chown -R ${uid}:${gid} ${absolute} . Or use a Docker named volume instead of a bind mount.`;
		throw new DataDirError(
			`Cannot write to the data directory ${absolute} (${code}). Tessera runs as ${who}. ${fix}`,
			{ cause }
		);
	}
}
