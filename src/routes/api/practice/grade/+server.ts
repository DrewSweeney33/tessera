import { handlePracticeGrade } from '#lib/server/api/practice.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handlePracticeGrade(app, event.request, event.locals.requestId)
);
