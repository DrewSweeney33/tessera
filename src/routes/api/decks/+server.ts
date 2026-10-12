import { handleCreateDeck, handleListDecks } from '#lib/server/api/decks.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleListDecks(app));

export const POST = route((app, event) =>
	handleCreateDeck(app, event.request, event.locals.requestId)
);
