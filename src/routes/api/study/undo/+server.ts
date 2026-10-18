import { handleStudyUndo } from '#lib/server/api/study.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleStudyUndo(app, event.request, event.locals.requestId)
);
