import { handleLogout } from '#lib/server/api/auth.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) => handleLogout(app, event.request));
