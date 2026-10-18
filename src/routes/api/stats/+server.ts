import { handleStats } from '#lib/server/api/stats.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) => handleStats(app, event.url, event.locals.requestId));
