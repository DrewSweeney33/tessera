import { handlePreviewRestore } from '#lib/server/api/restore.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handlePreviewRestore(app, event.params.name ?? '', event.locals.requestId)
);
