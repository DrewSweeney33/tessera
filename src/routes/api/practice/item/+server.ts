import { handlePracticeItem } from '#lib/server/api/practice.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handlePracticeItem(app, event.url, event.locals.requestId)
);
