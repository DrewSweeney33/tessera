import { z } from 'zod';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { fieldErrors } from '../http/validation.ts';

// What the routes that act on one deck by typing its title share (delete for good, start over): the 404, the small
// body, and the answers for a missing or wrong title.

const MAX_BODY_BYTES = 16 * 1024;

// An id that cannot be a deck id, an unknown deck, and a deck the action does not apply to get the same kind of
// 404, and the message only repeats an id that passed the id rules.
export function deckNotFound(deckId: string, requestId: string): Response {
	return errorResponse(
		'not_found',
		ID_PATTERN.test(deckId) ? `There is no deck "${deckId}".` : 'There is no such deck.',
		undefined,
		requestId
	);
}

const ConfirmBodySchema = z.strictObject({
	confirmTitle: z.string({ message: 'Type the deck title to confirm.' })
});

// Reads { "confirmTitle": "..." } from a request: a small body, valid JSON, exactly that field. Returns the typed
// title, or the response to send.
export async function readConfirmTitle(
	request: Request,
	requestId: string
): Promise<string | Response> {
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
	const parsed = ConfirmBodySchema.safeParse(raw);
	if (!parsed.success) {
		return errorResponse(
			'validation_failed',
			'Type the deck title to confirm.',
			{ errors: fieldErrors(parsed.error) },
			requestId
		);
	}
	return parsed.data.confirmTitle;
}

const MISMATCH = 'That is not the title of this deck. Type it exactly as it is shown to confirm.';

// The typed title was not the deck's title. Names the field so a form can show it beside the box, and does not
// repeat what was typed.
export function titleMismatch(requestId: string): Response {
	return errorResponse(
		'validation_failed',
		MISMATCH,
		{ errors: [{ path: 'confirmTitle', code: 'mismatch', message: MISMATCH }] },
		requestId
	);
}
