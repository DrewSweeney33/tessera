import { handleStartOver } from '#lib/server/api/start-over.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleStartOver(app, event.params.id ?? '', event.request, event.locals.requestId)
);
