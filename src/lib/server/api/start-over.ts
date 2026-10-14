import type { StartOverResponse } from '#lib/core/api-types.ts';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { resetDeckProgress } from '../decks/index.ts';
import { jsonResponse } from '../http/response.ts';
import { countActiveCardsByDeck, getDeck } from '../repos/index.ts';
import { deckNotFound, readConfirmTitle, snapshotContext, titleMismatch } from './deck-actions.ts';
import { summarize } from './decks.ts';

// POST /api/decks/:id/start-over (US-14, ADR-013). Puts every review item of the deck back to new, keeping the
// review history. The body carries the deck title as a person typed it. A snapshot is taken first; if it cannot be
// written (a full disk) nothing changes and the answer says why (507).
export async function handleStartOver(
	app: AppContext,
	deckId: string,
	request: Request,
	requestId: string
): Promise<Response> {
	if (!ID_PATTERN.test(deckId)) return deckNotFound(deckId, requestId);

	const typed = await readConfirmTitle(request, requestId);
	if (typed instanceof Response) return typed;

	const done = resetDeckProgress(snapshotContext(app), deckId, typed);
	if (!done.ok) {
		return done.error.kind === 'not_found'
			? deckNotFound(deckId, requestId)
			: titleMismatch(requestId);
	}

	const { snapshot, items, reviews } = done.value;
	// Not the title: it is the person's own text, and the id and the copy's name say what happened.
	app.log.info('deck started over', {
		requestId,
		deckId,
		items,
		reviews,
		snapshot: snapshot.name
	});
	const deck = getDeck(app.db, deckId);
	if (!deck) return deckNotFound(deckId, requestId);
	const body: StartOverResponse = {
		reset: { deckId, items, reviews, snapshot: { name: snapshot.name, size: snapshot.size } },
		deck: summarize(app, deck, countActiveCardsByDeck(app.db).get(deckId) ?? 0)
	};
	return jsonResponse(body);
}
