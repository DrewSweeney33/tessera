import { handleDeleteBackup, handleDownloadBackup } from '#lib/server/api/backups.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handleDownloadBackup(app, event.params.name ?? '', event.locals.requestId)
);

export const DELETE = route((app, event) =>
	handleDeleteBackup(app, event.params.name ?? '', event.locals.requestId)
);
