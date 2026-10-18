import { handleLogin } from '#lib/server/api/auth.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) => handleLogin(app, event.request, event.locals.requestId));
