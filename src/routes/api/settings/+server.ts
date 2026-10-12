import { handleGetSettings, handleUpdateSettings } from '#lib/server/api/settings.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleGetSettings(app));

export const PUT = route((app, event) =>
	handleUpdateSettings(app, event.request, event.locals.requestId)
);
