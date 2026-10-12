import { handleSetSuspended } from '#lib/server/api/leeches.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleSetSuspended(app, event.params.cardPk ?? '', true, event.locals.requestId)
);
