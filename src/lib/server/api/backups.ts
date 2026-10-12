import { createReadStream, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type {
	BackupDto,
	BackupsResponse,
	CreateBackupResponse,
	DeleteBackupResponse
} from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import {
	backupsFolder,
	createSnapshot,
	listSnapshots,
	type SnapshotInfo
} from '../backups/index.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';

// The Backups routes (US-15, ADR-014). A backup is a file in <data folder>/backups. It is named by its file name
// and never by a path: a name is served or deleted only if the listing shows it, which means it is a plain file
// in that folder with a safe name, and never the live database. Anything else is the same 404, and no answer
// carries a path from the server.

const toDto = (info: SnapshotInfo): BackupDto => ({
	name: info.name,
	kind: info.kind,
	size: info.size,
	modifiedAt: info.modifiedAt
});

function notFound(requestId: string): Response {
	return errorResponse('not_found', 'There is no such backup.', undefined, requestId);
}

// The listed backup with this name, if there is one.
function findBackup(app: AppContext, name: string): SnapshotInfo | undefined {
	return listSnapshots(app.config.dataDir).find((entry) => entry.name === name);
}

// GET /api/backups: every backup, newest first.
export function handleListBackups(app: AppContext): Response {
	const body: BackupsResponse = { backups: listSnapshots(app.config.dataDir).map(toDto) };
	return jsonResponse(body);
}

// POST /api/backups: takes a backup now. If it cannot be written (a full disk) the answer says so (507) and
// nothing is left behind.
export function handleCreateBackup(app: AppContext, requestId: string): Response {
	const info = createSnapshot(app.database.sqlite, app.config.dataDir, 'manual', app.clock);
	app.log.info('backup created', { requestId, backup: info.name, size: info.size });
	const body: CreateBackupResponse = { backup: toDto(info) };
	return jsonResponse(body, { status: 201 });
}

// GET /api/backups/:name: the file, as a download. Streamed, so a large database does not sit in memory.
export function handleDownloadBackup(app: AppContext, name: string, requestId: string): Response {
	const found = findBackup(app, name);
	if (!found) return notFound(requestId);
	const stream = createReadStream(join(backupsFolder(app.config.dataDir), found.name));
	const headers = new Headers({
		'content-type': 'application/octet-stream',
		'content-disposition': `attachment; filename="${found.name}"`,
		'content-length': String(found.size),
		'cache-control': 'no-store'
	});
	app.log.info('backup downloaded', { requestId, backup: found.name });
	return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
}

// DELETE /api/backups/:name: removes one backup after the page has asked for confirmation.
export function handleDeleteBackup(app: AppContext, name: string, requestId: string): Response {
	const found = findBackup(app, name);
	if (!found) return notFound(requestId);
	rmSync(join(backupsFolder(app.config.dataDir), found.name), { force: true });
	app.log.info('backup deleted', { requestId, backup: found.name });
	const body: DeleteBackupResponse = { deleted: found.name };
	return jsonResponse(body);
}
