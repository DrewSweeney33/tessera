import { handleGetDeck } from '#lib/server/api/deck.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handleGetDeck(app, event.params.id ?? '', event.locals.requestId)
);
