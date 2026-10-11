import { handleSchema } from '#lib/server/api/schema.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route(() => handleSchema());
