import { handleListTrash } from '#lib/server/api/trash.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app) => handleListTrash(app));
