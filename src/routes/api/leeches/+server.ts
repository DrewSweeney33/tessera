import { handleListLeeches } from '#lib/server/api/leeches.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) => handleListLeeches(app, event.url, event.locals.requestId));
