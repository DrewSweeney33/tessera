import { handleRestore } from '#lib/server/api/restore.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleRestore(app, event.params.name ?? '', event.request, event.locals.requestId)
);
