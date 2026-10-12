import type { DecksResponse, DeckSummaryDto } from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import type { DeckRow } from '../db/schema.ts';
import { createDeck } from '../decks/index.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { countActiveCardsByDeck, listDecks } from '../repos/index.ts';
import { countLeeches } from '../leeches/index.ts';
import { countQueue } from '../study/index.ts';

const MAX_CREATE_BODY_BYTES = 16 * 1024;

// One deck as the home page lists it. Counts come from the same function a study session uses, so the numbers
// on the home screen always match what a session will serve.
export function summarize(app: AppContext, deck: DeckRow, cardCount: number): DeckSummaryDto {
	return {
		id: deck.id,
		title: deck.title,
		description: deck.description,
		tags: deck.tags,
		cardCount,
		createdAt: deck.createdAt,
		updatedAt: deck.updatedAt,
		counts: countQueue(app.db, {
			scope: { deckId: deck.id },
			now: app.clock.now(),
			timeZone: app.config.timeZone
		})
	};
}

// GET /api/decks.
export function handleListDecks(app: AppContext): Response {
	const now = app.clock.now();
	const timeZone = app.config.timeZone;
	const cardCounts = countActiveCardsByDeck(app.db);

	const body: DecksResponse = {
		decks: listDecks(app.db).map((deck) => summarize(app, deck, cardCounts.get(deck.id) ?? 0)),
		totals: countQueue(app.db, { scope: {}, now, timeZone }),
		openLeeches: countLeeches(app.db)
	};
	return jsonResponse(body);
}

// POST /api/decks (US-11). Makes an empty deck from a title (and optionally an id, a description, and tags).
// The body is small, so a limit far below the import limit applies. A bad body is a 422 that names every field,
// a taken id is a 409 that a form can show next to the id field.
export async function handleCreateDeck(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const text = await readBodyText(
		request,
		MAX_CREATE_BODY_BYTES,
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

	const made = createDeck(app.db, body, app.clock.now().toISOString());
	if (!made.ok) {
		return made.error.kind === 'invalid'
			? errorResponse(
					'validation_failed',
					'The deck is not valid.',
					{ errors: made.error.errors },
					requestId
				)
			: errorResponse(
					'conflict',
					made.error.error.message,
					{ errors: [made.error.error] },
					requestId
				);
	}
	app.log.info('deck created', { requestId, deckId: made.value.id });
	return jsonResponse({ deck: summarize(app, made.value, 0) }, { status: 201 });
}
