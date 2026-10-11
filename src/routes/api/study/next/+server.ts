import { handleStudyNext } from '#lib/server/api/study.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) => handleStudyNext(app, event.url, event.locals.requestId));
