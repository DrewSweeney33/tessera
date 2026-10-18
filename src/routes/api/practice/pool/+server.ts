import { handlePracticePool } from '#lib/server/api/practice.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handlePracticePool(app, event.url, event.locals.requestId)
);
