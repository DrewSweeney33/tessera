import { handleDeleteForever } from '#lib/server/api/trash.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleDeleteForever(app, event.params.id ?? '', event.request, event.locals.requestId)
);
