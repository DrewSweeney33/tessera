import { z } from 'zod';
import type {
	BackupDto,
	DataSummaryDto,
	RestorePreviewResponse,
	RestoreResponse
} from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import { createSnapshot, listSnapshots } from '../backups/index.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import { summarizeLive } from '../repos/index.ts';
import { inspectBackup, stageRestore } from '../restore/index.ts';

// Restore from the Backups list (US-15, ADR-014). The server never swaps a database it has open. A restore is
// staged in a marker file, the server stops, and the next start applies it before opening the database. That needs
// something to start the server again: the restart policy in compose.yaml does.

const MAX_BODY_BYTES = 16 * 1024;

function notFound(requestId: string): Response {
	return errorResponse('not_found', 'There is no such backup.', undefined, requestId);
}

const toDto = (info: BackupDto): BackupDto => ({
	name: info.name,
	kind: info.kind,
	size: info.size,
	modifiedAt: info.modifiedAt
});

// GET /api/backups/:name/preview: what restoring this backup would bring back, beside what is there now. A backup
// that cannot be restored is still a 200 with the reason, so the page can show it where the button would be.
export function handlePreviewRestore(app: AppContext, name: string, requestId: string): Response {
	const inspected = inspectBackup(app.config.dataDir, name);
	const current: DataSummaryDto = summarizeLive(app.db);
	if (!inspected.ok && inspected.error.kind === 'not_found') return notFound(requestId);

	const listed = listSnapshots(app.config.dataDir).find((entry) => entry.name === name);
	if (!listed) return notFound(requestId);
	const body: RestorePreviewResponse = inspected.ok
		? { backup: toDto(listed), restorable: true, summary: inspected.value.summary, current }
		: { backup: toDto(listed), restorable: false, reason: inspected.error.message, current };
	return jsonResponse(body);
}

const RestoreBodySchema = z.strictObject({
	confirm: z.literal('restore', { message: 'Type the word restore to confirm.' })
});

// POST /api/backups/:name/restore. Takes a copy of the data as it is now, stages the restore, answers 202, and asks
// the server to stop. Nothing about the data changes until the restart. If the copy cannot be written (a full
// disk) nothing is staged and the answer says why (507).
export async function handleRestore(
	app: AppContext,
	name: string,
	request: Request,
	requestId: string
): Promise<Response> {
	const text = await readBodyText(
		request,
		MAX_BODY_BYTES,
		'The request body is too large.',
		requestId
	);
	if (text instanceof Response) return text;

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return errorResponse('bad_request', 'The body must be valid JSON.', undefined, requestId);
	}
	// Before the body is judged, so a caller learns nothing about which names exist from the body's shape.
	const inspected = inspectBackup(app.config.dataDir, name);
	if (!inspected.ok && inspected.error.kind === 'not_found') return notFound(requestId);

	const parsed = RestoreBodySchema.safeParse(raw);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'Type the word restore to confirm.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	if (!inspected.ok) {
		return errorResponse('validation_failed', inspected.error.message, undefined, requestId);
	}

	const safety = createSnapshot(app.database.sqlite, app.config.dataDir, 'pre-restore', app.clock);
	const staged = stageRestore(app.config.dataDir, name, app.clock);
	if (!staged.ok) {
		return staged.error.kind === 'already_pending'
			? errorResponse('conflict', staged.error.message, undefined, requestId)
			: errorResponse('validation_failed', staged.error.message, undefined, requestId);
	}
	app.log.info('restore staged, stopping so it can be applied', {
		requestId,
		backup: name,
		safetyCopy: safety.name
	});
	const body: RestoreResponse = { restoring: { name, safetyCopy: safety.name } };
	const response = jsonResponse(body, { status: 202 });
	app.requestShutdown();
	return response;
}
