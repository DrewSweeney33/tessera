import { handleTrashDeck } from '#lib/server/api/trash.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleTrashDeck(app, event.params.id ?? '', event.locals.requestId)
);
