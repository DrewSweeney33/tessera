import type {
	DeleteDeckResponse,
	RestoreDeckResponse,
	TrashDeckResponse,
	TrashedDeckDto,
	TrashResponse
} from '#lib/core/api-types.ts';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import {
	deleteDeckForever,
	listTrash,
	moveToTrash,
	restoreFromTrash,
	type TrashedDeck
} from '../decks/index.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { countActiveCardsByDeck } from '../repos/index.ts';
import { deckNotFound, readConfirmTitle, snapshotContext, titleMismatch } from './deck-actions.ts';
import { summarize } from './decks.ts';

// The Trash over HTTP (US-13, ADR-013). Three small writes, all behind the same guards as every other write: the
// host check, the JSON-only rule, and the token rule for callers that are not the page.

function toDto(item: TrashedDeck): TrashedDeckDto {
	return {
		id: item.deck.id,
		title: item.deck.title,
		description: item.deck.description,
		tags: item.deck.tags,
		cardCount: item.cardCount,
		reviewCount: item.reviewCount,
		trashedAt: item.deck.updatedAt
	};
}

// GET /api/trash.
export function handleListTrash(app: AppContext): Response {
	const body: TrashResponse = { decks: listTrash(app.db).map(toDto) };
	return jsonResponse(body);
}

// POST /api/decks/:id/trash. Moving a deck that is already in the Trash is not an error.
export function handleTrashDeck(app: AppContext, deckId: string, requestId: string): Response {
	if (!ID_PATTERN.test(deckId)) return deckNotFound(deckId, requestId);
	const moved = moveToTrash(app.db, deckId, app.clock.now().toISOString());
	if (!moved.ok) return deckNotFound(deckId, requestId);
	const item = listTrash(app.db).find((entry) => entry.deck.id === deckId);
	if (!item) return deckNotFound(deckId, requestId);
	app.log.info('deck moved to the trash', { requestId, deckId });
	const body: TrashDeckResponse = { deck: toDto(item) };
	return jsonResponse(body);
}

// POST /api/decks/:id/restore.
export function handleRestoreDeck(app: AppContext, deckId: string, requestId: string): Response {
	if (!ID_PATTERN.test(deckId)) return deckNotFound(deckId, requestId);
	const restored = restoreFromTrash(app.db, deckId, app.clock.now().toISOString());
	if (!restored.ok) return deckNotFound(deckId, requestId);
	app.log.info('deck restored from the trash', { requestId, deckId });
	const cardCount = countActiveCardsByDeck(app.db).get(deckId) ?? 0;
	const body: RestoreDeckResponse = { deck: summarize(app, restored.value, cardCount) };
	return jsonResponse(body);
}

// POST /api/decks/:id/delete-forever. A DELETE with a body is not reliable through proxies, so this is a POST.
// The deck must be in the Trash and the body must carry its title as a person typed it. A snapshot is taken first;
// if it cannot be written (a full disk), nothing is deleted and the answer says why (507).
export async function handleDeleteForever(
	app: AppContext,
	deckId: string,
	request: Request,
	requestId: string
): Promise<Response> {
	if (!ID_PATTERN.test(deckId)) return deckNotFound(deckId, requestId);

	const typed = await readConfirmTitle(request, requestId);
	if (typed instanceof Response) return typed;

	const deleted = deleteDeckForever(snapshotContext(app), deckId, typed);
	if (!deleted.ok) {
		switch (deleted.error.kind) {
			case 'not_found':
				return deckNotFound(deckId, requestId);
			case 'not_in_trash':
				return errorResponse(
					'conflict',
					'Move the deck to the Trash first. Only a deck in the Trash can be deleted for good.',
					undefined,
					requestId
				);
			case 'confirmation_mismatch':
				return titleMismatch(requestId);
		}
	}

	const { snapshot, cards, reviews } = deleted.value;
	// Not the title: it is the person's own text, and the id and the copy's name say what happened.
	app.log.info('deck deleted for good', {
		requestId,
		deckId,
		cards,
		reviews,
		snapshot: snapshot.name
	});
	const body: DeleteDeckResponse = {
		deleted: {
			deckId,
			title: typed.trim(),
			cards,
			reviews,
			snapshot: { name: snapshot.name, size: snapshot.size }
		}
	};
	return jsonResponse(body);
}
