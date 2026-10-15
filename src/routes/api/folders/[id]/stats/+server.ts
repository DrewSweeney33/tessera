import { handleFolderStats } from '#lib/server/api/folders.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handleFolderStats(app, event.params.id ?? '', event.locals.requestId)
);
