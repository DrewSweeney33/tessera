import { handleCreateBackup, handleListBackups } from '#lib/server/api/backups.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleListBackups(app));

export const POST = route((app, event) => handleCreateBackup(app, event.locals.requestId));
