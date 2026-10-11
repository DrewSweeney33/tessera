import { handleStudyReview } from '#lib/server/api/study.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleStudyReview(app, event.request, event.locals.requestId)
);
