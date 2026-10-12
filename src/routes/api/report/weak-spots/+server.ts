import { handleWeakSpotReport } from '#lib/server/api/leeches.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handleWeakSpotReport(app, event.url, event.locals.requestId)
);
