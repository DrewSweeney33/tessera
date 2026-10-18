import type {
	PracticeGradeResponse,
	PracticeUndoResponse,
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
	PracticeTagSchema,
	PracticeUndoSchema,
	QuizSeedSchema,
	getPracticeItem,
	poolCounts,
	recordPractice,
	startPracticeSession,
	undoPractice
} from '../practice/index.ts';
import { getDeck, getFolder, type QueueScope } from '../repos/index.ts';
import { sessionScope } from './study.ts';

// Practice again over HTTP (ADR-017). None of these routes can change a schedule: pool and item only read, start
// only reads and orders, and grade adds one row to the review log.

// A practice scope is exactly one deck, one folder, or one tag (unlike study, "everything" is not offered).
function practiceScope(
	app: AppContext,
	deckParam: string | null | undefined,
	folderParam: string | number | null | undefined,
	tagParam: string | null | undefined,
	requestId: string
): QueueScope | Response {
	const tagged = tagParam !== null && tagParam !== undefined;
	if (tagged) {
		const named = [deckParam, folderParam].some(
			(value) => value !== null && value !== undefined && value !== ''
		);
		if (named) {
			return errorResponse(
				'bad_request',
				'Practice one deck, one folder, or one tag, not more than one.',
				undefined,
				requestId
			);
		}
		if (!PracticeTagSchema.safeParse(tagParam).success) {
			return errorResponse('bad_request', 'The tag is not valid.', undefined, requestId);
		}
		return { tag: tagParam };
	}
	const scope = sessionScope(app, deckParam, folderParam, requestId);
	if (scope instanceof Response) return scope;
	if (scope.deckId === undefined && scope.folderId === undefined) {
		return errorResponse(
			'bad_request',
			'Name a deck, a folder, or a tag to practice.',
			undefined,
			requestId
		);
	}
	return scope;
}

function scopeLabel(app: AppContext, scope: QueueScope): string {
	if (scope.tag !== undefined) return `Tag: ${scope.tag}`;
	if (scope.folderId !== undefined) return getFolder(app.db, scope.folderId)?.name ?? 'Folder';
	return scope.deckId === undefined
		? 'All decks'
		: (getDeck(app.db, scope.deckId)?.title ?? scope.deckId);
}

// GET /api/practice/pool?deckId=, ?folderId=, or ?tag=
export function handlePracticePool(app: AppContext, url: URL, requestId: string): Response {
	const scope = practiceScope(
		app,
		url.searchParams.get('deckId'),
		url.searchParams.get('folderId'),
		url.searchParams.get('tag'),
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
	const { deckId, folderId, tag, quiz, count, order } = parsed.data;
	const scope = practiceScope(app, deckId, folderId, tag, requestId);
	if (scope instanceof Response) return scope;
	const started: PracticeStartResponse = startPracticeSession(
		app.db,
		{ scope, count, order, ...(quiz === true ? { quiz: true } : {}) },
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
	// A quiz session sends its seed with every item, so the options are the same after a reload (ADR-020).
	const seedText = url.searchParams.get('quizSeed');
	if (seedText !== null && !QuizSeedSchema.safeParse(seedText).success) {
		return errorResponse('bad_request', 'quizSeed is not valid.', undefined, requestId);
	}
	const item = getPracticeItem(
		app.db,
		Number(cardText),
		Number(ordinalText),
		seedText === null ? {} : { quizSeed: seedText }
	);
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

// POST /api/practice/undo (ADR-019). Deletes the most recent practice answer, and nothing else.
export async function handlePracticeUndo(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;
	const parsed = PracticeUndoSchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The undo is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const result = undoPractice(app.db, parsed.data);
	if (!result.ok) {
		return errorResponse(
			result.error.code === 'not_found' ? 'not_found' : 'conflict',
			result.error.message,
			{ reason: result.error.code },
			requestId
		);
	}
	const response: PracticeUndoResponse = { undone: result.value };
	return jsonResponse(response);
}
