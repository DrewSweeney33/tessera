import { handleCreateFolder, handleListFolders } from '#lib/server/api/folders.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleListFolders(app));

export const POST = route((app, event) =>
	handleCreateFolder(app, event.request, event.locals.requestId)
);
