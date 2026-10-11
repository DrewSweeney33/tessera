import { handleListDecks } from '#lib/server/api/decks.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleListDecks(app));
