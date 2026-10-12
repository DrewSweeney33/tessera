import type { GetDeckResponse } from '#lib/core/api-types.ts';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { deckRevision } from '../decks/index.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { readDeckDocument } from '../export/index.ts';
import { getDeck } from '../repos/index.ts';
import { summarize } from './decks.ts';

// GET /api/decks/:id (ADR-013). What an editor needs in one request: the deck as a document (a deck with no cards is
// fine here), the deck as the home page lists it, and the revision that a save sends back as expected_revision.
//
// An id that cannot be a deck id, an unknown deck, and a deck in the Trash all get the same 404, and the message only
// repeats an id that passed the id rules.
export function handleGetDeck(app: AppContext, deckId: string, requestId: string): Response {
	const notFound = () =>
		errorResponse(
			'not_found',
			ID_PATTERN.test(deckId) ? `There is no deck "${deckId}".` : 'There is no such deck.',
			undefined,
			requestId
		);
	if (!ID_PATTERN.test(deckId)) return notFound();

	const document = readDeckDocument(app.db, deckId);
	const row = getDeck(app.db, deckId);
	const revision = deckRevision(app.db, deckId);
	if (!document || !row || revision === undefined) return notFound();

	const body: GetDeckResponse = {
		document,
		deck: summarize(app, row, document.cards.length),
		revision
	};
	return jsonResponse(body);
}
