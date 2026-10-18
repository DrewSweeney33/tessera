import { createReadStream, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type {
	BackupDto,
	BackupLimitDto,
	BackupsResponse,
	CreateBackupResponse,
	DeleteBackupResponse
} from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import {
	backupsFolder,
	createSnapshot,
	findSnapshot,
	listSnapshots,
	type SnapshotInfo
} from '../backups/index.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { readLastRestore, readPendingRestore } from '../restore/index.ts';

// The Backups routes (US-15, ADR-014). A backup is a file in <data folder>/backups. It is named by its file name
// and never by a path: a name is served or deleted only if the listing shows it, which means it is a plain file
// in that folder with a safe name, and never the live database. Anything else is the same 404, and no answer
// carries a path from the server.

export function toBackupDto(info: SnapshotInfo): BackupDto {
	return {
		name: info.name,
		kind: info.kind,
		size: info.size,
		modifiedAt: info.modifiedAt
	};
}

export function backupNotFound(requestId: string): Response {
	return errorResponse('not_found', 'There is no such backup.', undefined, requestId);
}

// The counts behind the limit. Only manual backups count toward it: the safety copies Tessera makes before a delete, a
// restore, or an upgrade are never refused, never counted, and never deleted, so the limit cannot get in the way of
// the protection they give. Their total size is shown instead, so a growing pile is visible.
export function backupLimitOf(app: AppContext, snapshots: SnapshotInfo[]): BackupLimitDto {
	const safety = snapshots.filter((s) => s.kind !== 'manual' && s.kind !== 'other');
	return {
		manualCount: snapshots.filter((s) => s.kind === 'manual').length,
		maxManual: app.config.maxBackups,
		safetyCopies: safety.length,
		safetyCopiesBytes: safety.reduce((total, s) => total + s.size, 0)
	};
}

// GET /api/backups: every backup, newest first.
export function handleListBackups(app: AppContext): Response {
	const last = readLastRestore(app.config.dataDir);
	const pending = readPendingRestore(app.config.dataDir)?.name;
	const snapshots = listSnapshots(app.config.dataDir);
	const body: BackupsResponse = {
		backups: snapshots.map(toBackupDto),
		limit: backupLimitOf(app, snapshots),
		...(last
			? { lastRestore: { ok: last.ok, name: last.name, at: last.at, message: last.message } }
			: {}),
		...(pending ? { pendingRestore: pending } : {})
	};
	return jsonResponse(body);
}

// POST /api/backups: takes a backup now. At the limit (TESSERA_MAX_BACKUPS manual backups) it is refused with 409
// before anything is written, and Tessera deletes nothing itself: the person chooses which one to remove. If it
// cannot be written (a full disk) the answer says so (507) and nothing is left behind, so a failed attempt does not
// use up a place.
export function handleCreateBackup(app: AppContext, requestId: string): Response {
	const limit = backupLimitOf(app, listSnapshots(app.config.dataDir));
	if (limit.manualCount >= limit.maxManual) {
		app.log.warn('backup refused, the limit is reached', {
			requestId,
			manualCount: limit.manualCount,
			maxManual: limit.maxManual
		});
		return errorResponse(
			'backup_limit',
			`There are already ${limit.manualCount} backups, the most Tessera keeps (${limit.maxManual}). Delete one you no longer need on this page, then back up again.`,
			{ manualCount: limit.manualCount, maxManual: limit.maxManual },
			requestId
		);
	}
	const info = createSnapshot(app.database.sqlite, app.config.dataDir, 'manual', app.clock);
	app.log.info('backup created', { requestId, backup: info.name, size: info.size });
	const body: CreateBackupResponse = { backup: toBackupDto(info) };
	return jsonResponse(body, { status: 201 });
}

// GET /api/backups/:name: the file, as a download. Streamed, so a large database does not sit in memory.
export function handleDownloadBackup(app: AppContext, name: string, requestId: string): Response {
	const found = findSnapshot(app.config.dataDir, name);
	if (!found) return backupNotFound(requestId);
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
	const found = findSnapshot(app.config.dataDir, name);
	if (!found) return backupNotFound(requestId);
	rmSync(join(backupsFolder(app.config.dataDir), found.name), { force: true });
	app.log.info('backup deleted', { requestId, backup: found.name });
	const body: DeleteBackupResponse = { deleted: found.name };
	return jsonResponse(body);
}
