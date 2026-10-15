import { handleAssignDecks } from '#lib/server/api/folders.ts';
import { route } from '#lib/server/http/route.ts';

export const PUT = route((app, event) =>
	handleAssignDecks(app, event.request, event.locals.requestId)
);
