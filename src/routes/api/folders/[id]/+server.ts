import { handleDeleteFolder, handleRenameFolder } from '#lib/server/api/folders.ts';
import { route } from '#lib/server/http/route.ts';

export const PUT = route((app, event) =>
	handleRenameFolder(app, event.params.id ?? '', event.request, event.locals.requestId)
);

export const DELETE = route((app, event) =>
	handleDeleteFolder(app, event.params.id ?? '', event.locals.requestId)
);
