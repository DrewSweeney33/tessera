import type { DecksResponse } from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import { jsonResponse } from '../http/response.ts';
import { countActiveCardsByDeck, listDecks } from '../repos/index.ts';
import { countQueue } from '../study/index.ts';

// GET /api/decks. Counts come from the same function a study session uses, so the numbers on the
// home screen always match what a session will serve.
export function handleListDecks(app: AppContext): Response {
	const now = app.clock.now();
	const timeZone = app.config.timeZone;
	const cardCounts = countActiveCardsByDeck(app.db);

	const body: DecksResponse = {
		decks: listDecks(app.db).map((deck) => ({
			id: deck.id,
			title: deck.title,
			description: deck.description,
			tags: deck.tags,
			cardCount: cardCounts.get(deck.id) ?? 0,
			createdAt: deck.createdAt,
			updatedAt: deck.updatedAt,
			counts: countQueue(app.db, { scope: { deckId: deck.id }, now, timeZone })
		})),
		totals: countQueue(app.db, { scope: {}, now, timeZone })
	};
	return jsonResponse(body);
}
