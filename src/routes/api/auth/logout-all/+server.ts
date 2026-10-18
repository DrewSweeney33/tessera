import { handleLogoutAll } from '#lib/server/api/auth.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleLogoutAll(app, event.request, event.locals.requestId)
);
