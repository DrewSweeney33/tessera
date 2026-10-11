import { handleHealth } from '#lib/server/api/health.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleHealth(app));
