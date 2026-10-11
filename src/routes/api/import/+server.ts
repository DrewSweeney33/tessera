import { handleImport } from '#lib/server/api/import.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) => handleImport(app, event.request, event.locals.requestId));
