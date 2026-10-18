import { z } from 'zod';
import type {
	AssignDecksResponse,
	DeleteFolderResponse,
	FolderResponse,
	FoldersResponse
} from '#lib/core/api-types.ts';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import {
	assignDecks,
	createFolder,
	deleteFolder,
	folderStats,
	folderSummary,
	listFolderSummaries,
	updateFolder,
	type FolderProblem
} from '../folders/index.ts';
import { readJsonBody } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import { getFolder } from '../repos/index.ts';

// Project folders over HTTP. Folders are labels for decks: none of these routes changes a card, a schedule, or a
// review, and none can delete a deck. The bodies are small.

const MAX_ASSIGNED_DECKS = 500;
const NameBodySchema = z.strictObject({ name: z.string({ message: 'Give the folder a name.' }) });
// A change to an existing folder: its name, its exam date (null clears it), or both. At least one is required.
const ChangeBodySchema = z
	.strictObject({
		name: z.string({ message: 'Give the folder a name.' }).optional(),
		examDate: z
			.string({ message: 'The exam date must be written as year-month-day, or null to clear it.' })
			.max(10)
			.nullable()
			.optional()
	})
	.refine((body) => body.name !== undefined || body.examDate !== undefined, {
		message: 'Send a name, an exam date, or both.'
	});
const AssignBodySchema = z.strictObject({
	deckIds: z
		.array(z.string().max(64), { message: 'deckIds must be a list of deck ids.' })
		.min(1, 'Choose at least one deck.')
		.max(MAX_ASSIGNED_DECKS, `Move at most ${MAX_ASSIGNED_DECKS} decks at a time.`),
	folderId: z
		.number({ message: 'folderId must be a folder id, or null for no folder.' })
		.int()
		.positive()
		.nullable()
});

// A folder id as it appears in a path or query: digits only, short enough to be exact.
export function parseFolderId(text: string | null | undefined): number | undefined {
	return text !== null && text !== undefined && /^[1-9][0-9]{0,8}$/.test(text)
		? Number(text)
		: undefined;
}

function folderNotFound(requestId: string): Response {
	return errorResponse('not_found', 'There is no such folder.', undefined, requestId);
}

function problemResponse(problem: FolderProblem, requestId: string): Response {
	switch (problem.kind) {
		case 'invalid_name':
			return errorResponse(
				'validation_failed',
				problem.message,
				{ errors: [{ path: 'name', code: problem.code, message: problem.message }] },
				requestId
			);
		case 'invalid_exam_date':
			return errorResponse(
				'validation_failed',
				problem.message,
				{ errors: [{ path: 'examDate', code: problem.code, message: problem.message }] },
				requestId
			);
		case 'name_taken':
			return errorResponse(
				'conflict',
				problem.message,
				{ errors: [{ path: 'name', code: 'name_taken', message: problem.message }] },
				requestId
			);
		case 'not_found':
			return folderNotFound(requestId);
	}
}

async function readName(request: Request, requestId: string): Promise<string | Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = NameBodySchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The folder is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	return parsed.data.name;
}

function context(app: AppContext) {
	return { now: app.clock.now(), timeZone: app.config.timeZone };
}

// GET /api/folders.
export function handleListFolders(app: AppContext): Response {
	const body: FoldersResponse = { folders: listFolderSummaries(app.db, context(app)) };
	return jsonResponse(body);
}

// POST /api/folders. 201 with the folder; 422 for a bad name, 409 for a name already used.
export async function handleCreateFolder(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const name = await readName(request, requestId);
	if (name instanceof Response) return name;
	const made = createFolder(app.db, name, app.clock.now().toISOString());
	if (!made.ok) return problemResponse(made.error, requestId);
	app.log.info('folder created', { requestId, folderId: made.value.id });
	const body: FolderResponse = { folder: folderSummary(app.db, made.value, context(app)) };
	return jsonResponse(body, { status: 201 });
}

// PUT /api/folders/:id changes the folder's name, its exam date, or both.
export async function handleRenameFolder(
	app: AppContext,
	idText: string,
	request: Request,
	requestId: string
): Promise<Response> {
	const id = parseFolderId(idText);
	if (id === undefined) return folderNotFound(requestId);
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = ChangeBodySchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The folder is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const { name, examDate } = parsed.data;
	const changed = updateFolder(
		app.db,
		id,
		{
			...(name === undefined ? {} : { name }),
			...(examDate === undefined ? {} : { examDate })
		},
		app.clock.now().toISOString()
	);
	if (!changed.ok) return problemResponse(changed.error, requestId);
	app.log.info('folder changed', { requestId, folderId: id });
	const response: FolderResponse = { folder: folderSummary(app.db, changed.value, context(app)) };
	return jsonResponse(response);
}

// DELETE /api/folders/:id. The decks in it go back to the ungrouped list. Nothing else is deleted, so no title is
// asked for and no snapshot is needed.
export function handleDeleteFolder(app: AppContext, idText: string, requestId: string): Response {
	const id = parseFolderId(idText);
	if (id === undefined) return folderNotFound(requestId);
	const deleted = deleteFolder(app.db, id);
	if (!deleted.ok) return folderNotFound(requestId);
	app.log.info('folder deleted', { requestId, folderId: id, decks: deleted.value.decks });
	const body: DeleteFolderResponse = { deleted: deleted.value };
	return jsonResponse(body);
}

// GET /api/folders/:id/stats.
export function handleFolderStats(app: AppContext, idText: string, requestId: string): Response {
	const id = parseFolderId(idText);
	const folder = id === undefined ? undefined : getFolder(app.db, id);
	if (!folder) return folderNotFound(requestId);
	return jsonResponse(folderStats(app.db, folder, context(app)));
}

function deckNotFound(message: string, requestId: string): Response {
	return errorResponse(
		'not_found',
		message,
		{ errors: [{ path: 'deckIds', code: 'not_found', message }] },
		requestId
	);
}

// PUT /api/folder-assignments { deckIds, folderId }. All or nothing: one unknown deck or folder changes nothing.
export async function handleAssignDecks(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = AssignBodySchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The request is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const { deckIds, folderId } = parsed.data;
	if (deckIds.some((id) => !ID_PATTERN.test(id))) {
		return deckNotFound('There is no such deck.', requestId);
	}
	const moved = assignDecks(app.db, deckIds, folderId);
	if (!moved.ok) {
		return moved.error.kind === 'folder_not_found'
			? folderNotFound(requestId)
			: deckNotFound(`There is no deck "${moved.error.deckId}".`, requestId);
	}
	app.log.info('decks moved', { requestId, folderId, decks: moved.value.moved });
	const response: AssignDecksResponse = { folderId, moved: moved.value.moved };
	return jsonResponse(response);
}
