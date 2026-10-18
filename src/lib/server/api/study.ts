import { z } from 'zod';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { readJsonBody } from '../http/body.ts';
import { errorResponse, type ApiErrorCode } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import { getDeck, getFolder, type QueueScope } from '../repos/index.ts';
import { parseFolderId } from './folders.ts';
import {
	ReviewInputSchema,
	buildNext,
	submitReview,
	type NextResponse,
	type ReviewFailureCode
} from '../study/index.ts';

// A review plus the deck being studied (optional), so the response can include the next item.
// Still strict: unknown fields are rejected.
const StudyReviewBodySchema = ReviewInputSchema.extend({
	deckId: z.string().max(64).optional(),
	folderId: z.number().int().positive().max(999_999_999).optional()
});

// What a session is limited to: one deck, one folder, or nothing (every deck).
type Scope = QueueScope;

function nextFor(app: AppContext, scope: Scope): NextResponse {
	return buildNext(app.db, {
		scope,
		now: app.clock.now(),
		timeZone: app.config.timeZone,
		rng: app.rng
	});
}

// Validates an optional deck id from the query string or body. Returns a Response on failure.
function deckScope(
	app: AppContext,
	deckId: string | null | undefined,
	requestId: string
): string | undefined | Response {
	if (deckId === null || deckId === undefined || deckId === '') return undefined;
	if (!ID_PATTERN.test(deckId)) {
		return errorResponse('bad_request', 'deckId is not a valid deck id.', undefined, requestId);
	}
	if (!getDeck(app.db, deckId)) {
		return errorResponse('not_found', `There is no deck "${deckId}".`, undefined, requestId);
	}
	return deckId;
}

// Validates the optional deck and folder a request is limited to. Naming both is refused: a session has one scope.
export function sessionScope(
	app: AppContext,
	deckParam: string | null | undefined,
	folderParam: string | number | null | undefined,
	requestId: string
): Scope | Response {
	const deckId = deckScope(app, deckParam, requestId);
	if (deckId instanceof Response) return deckId;
	const folderId =
		typeof folderParam === 'number' ? folderParam : parseFolderId(folderParam ?? undefined);
	const named = folderParam !== null && folderParam !== undefined && folderParam !== '';
	if (named && deckId !== undefined) {
		return errorResponse(
			'bad_request',
			'Study one deck or one folder, not both.',
			undefined,
			requestId
		);
	}
	if (named) {
		if (folderId === undefined) {
			return errorResponse(
				'bad_request',
				'folderId is not a valid folder id.',
				undefined,
				requestId
			);
		}
		if (!getFolder(app.db, folderId)) {
			return errorResponse('not_found', 'There is no such folder.', undefined, requestId);
		}
		return { folderId };
	}
	return deckId === undefined ? {} : { deckId };
}

// GET /api/study/next?deckId=ccna-ospf or ?folderId=3
export function handleStudyNext(app: AppContext, url: URL, requestId: string): Response {
	const scope = sessionScope(
		app,
		url.searchParams.get('deckId'),
		url.searchParams.get('folderId'),
		requestId
	);
	if (scope instanceof Response) return scope;
	return jsonResponse(nextFor(app, scope));
}

const FAILURE_STATUS: Record<ReviewFailureCode, ApiErrorCode> = {
	not_found: 'not_found',
	stale_review: 'stale_review',
	review_id_reused: 'bad_request'
};

// POST /api/study/review. The body is a ReviewInput plus an optional deckId. The response carries the
// recorded result and the next item, so a session normally needs one request per card (ADR-003).
export async function handleStudyReview(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;

	const parsed = StudyReviewBodySchema.safeParse(body.value);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The review is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const { deckId: requestedDeck, folderId: requestedFolder, ...input } = parsed.data;
	const scope = sessionScope(app, requestedDeck, requestedFolder, requestId);
	if (scope instanceof Response) return scope;

	const result = submitReview(app.db, input, { clock: app.clock, timeZone: app.config.timeZone });
	if (!result.ok) {
		return errorResponse(
			FAILURE_STATUS[result.error.code],
			result.error.message,
			{ reason: result.error.code },
			requestId
		);
	}
	return jsonResponse({ result: result.value, next: nextFor(app, scope) });
}
