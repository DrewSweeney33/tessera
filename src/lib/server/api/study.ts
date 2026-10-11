import { z } from 'zod';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse, type ApiErrorCode } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { fieldErrors } from '../http/validation.ts';
import { getDeck } from '../repos/index.ts';
import {
	ReviewInputSchema,
	buildNext,
	submitReview,
	type NextResponse,
	type ReviewFailureCode
} from '../study/index.ts';

const MAX_BODY_BYTES = 16 * 1024;

// A review plus the deck being studied (optional), so the response can include the next item.
// Still strict: unknown fields are rejected.
const StudyReviewBodySchema = ReviewInputSchema.extend({
	deckId: z.string().max(64).optional()
});

function nextFor(app: AppContext, deckId: string | undefined): NextResponse {
	return buildNext(app.db, {
		scope: deckId === undefined ? {} : { deckId },
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

// GET /api/study/next?deckId=ccna-ospf
export function handleStudyNext(app: AppContext, url: URL, requestId: string): Response {
	const deckId = deckScope(app, url.searchParams.get('deckId'), requestId);
	if (deckId instanceof Response) return deckId;
	return jsonResponse(nextFor(app, deckId));
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
	const text = await readBodyText(
		request,
		MAX_BODY_BYTES,
		'The request body is too large.',
		requestId
	);
	if (text instanceof Response) return text;

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return errorResponse('bad_request', 'The body must be valid JSON.', undefined, requestId);
	}

	const parsed = StudyReviewBodySchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'The review is not valid.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	const { deckId: requestedDeck, ...input } = parsed.data;
	const deckId = deckScope(app, requestedDeck, requestId);
	if (deckId instanceof Response) return deckId;

	const result = submitReview(app.db, input, { clock: app.clock, timeZone: app.config.timeZone });
	if (!result.ok) {
		return errorResponse(
			FAILURE_STATUS[result.error.code],
			result.error.message,
			{ reason: result.error.code },
			requestId
		);
	}
	return jsonResponse({ result: result.value, next: nextFor(app, deckId) });
}
