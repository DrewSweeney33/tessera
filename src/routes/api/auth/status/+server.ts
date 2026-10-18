import { handleAuthStatus } from '#lib/server/api/auth.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) => handleAuthStatus(app, event.request));
