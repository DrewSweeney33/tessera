import type { AppContext } from '../app.ts';
import { jsonResponse } from '../http/response.ts';
import { countActiveCardsByDeck, listDecks } from '../repos/index.ts';

// GET /api/decks. Due and new counts are added with the study queue (M1-17).
export function handleListDecks(app: AppContext): Response {
	const counts = countActiveCardsByDeck(app.db);
	return jsonResponse({
		decks: listDecks(app.db).map((deck) => ({
			id: deck.id,
			title: deck.title,
			description: deck.description,
			tags: deck.tags,
			cardCount: counts.get(deck.id) ?? 0,
			createdAt: deck.createdAt,
			updatedAt: deck.updatedAt
		}))
	});
}
