import type {
	PracticeGradeResponse,
	PracticeItemResponse,
	PracticePoolResponse,
	PracticeStartResponse
} from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import { readJsonBody } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import {
	PracticeGradeSchema,
	PracticeStartSchema,
	getPracticeItem,
	poolCounts,
	recordPractice,
	startPracticeSession
} from '../practice/index.ts';
import { getDeck, getFolder, type QueueScope } from '../repos/index.ts';
import { sessionScope } from './study.ts';

// Practice again over HTTP (ADR-017). None of these routes can change a schedule: pool and item only read, start
// only reads and orders, and grade adds one row to the review log.

// A practice scope is exactly one deck or one folder (unlike study, "everything" is not offered).
function practiceScope(
	app: AppContext,
	deckParam: string | null | undefined,
	folderParam: string | number | null | undefined,
	requestId: string
): QueueScope | Response {
	const scope = sessionScope(app, deckParam, folderParam, requestId);
	if (scope instanceof Response) return scope;
	if (scope.deckId === undefined && scope.folderId === undefined) {
		return errorResponse(
			'bad_request',
			'Name a deck or a folder to practice.',
			undefined,
			requestId
		);
	}
	return scope;
}

function scopeLabel(app: AppContext, scope: QueueScope): string {
	if (scope.folderId !== undefined) return getFolder(app.db, scope.folderId)?.name ?? 'Folder';
	return scope.deckId === undefined
		? 'All decks'
		: (getDeck(app.db, scope.deckId)?.title ?? scope.deckId);
}

// GET /api/practice/pool?deckId= or ?folderId=
export function handlePracticePool(app: AppContext, url: URL, requestId: string): Response {
	const scope = practiceScope(
		app,
		url.searchParams.get('deckId'),
		url.searchParams.get('folderId'),
		requestId
	);
	if (scope instanceof Response) return scope;
	const counts = poolCounts(app.db, scope, app.clock.now());
	const body: PracticePoolResponse = { label: scopeLabel(app, scope), ...counts };
	return jsonResponse(body);
}

// POST /api/practice/start
export async function handlePracticeStart(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = PracticeStartSchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The practice request is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const { deckId, folderId, count, order } = parsed.data;
	const scope = practiceScope(app, deckId, folderId, requestId);
	if (scope instanceof Response) return scope;
	const started: PracticeStartResponse = startPracticeSession(
		app.db,
		{ scope, count, order },
		{ now: app.clock.now(), rng: app.rng }
	);
	return jsonResponse(started);
}

// GET /api/practice/item?cardPk=&ordinal=
export function handlePracticeItem(app: AppContext, url: URL, requestId: string): Response {
	const cardText = url.searchParams.get('cardPk') ?? '';
	const ordinalText = url.searchParams.get('ordinal') ?? '';
	if (!/^[1-9][0-9]{0,9}$/.test(cardText) || !/^[0-9]{1,2}$/.test(ordinalText)) {
		return errorResponse(
			'bad_request',
			'cardPk and ordinal must be whole numbers.',
			undefined,
			requestId
		);
	}
	const item = getPracticeItem(app.db, Number(cardText), Number(ordinalText));
	if (!item) {
		return errorResponse('not_found', 'That card cannot be practiced.', undefined, requestId);
	}
	const body: PracticeItemResponse = { item };
	return jsonResponse(body);
}

// POST /api/practice/grade
export async function handlePracticeGrade(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = PracticeGradeSchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The answer is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const result = recordPractice(app.db, parsed.data, { clock: app.clock });
	if (!result.ok) {
		return errorResponse(
			result.error.code === 'not_found' ? 'not_found' : 'bad_request',
			result.error.message,
			{ reason: result.error.code },
			requestId
		);
	}
	const response: PracticeGradeResponse = { replayed: result.value.replayed };
	return jsonResponse(response);
}
