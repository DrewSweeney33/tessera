import { handleExportDeck } from '#lib/server/api/export.ts';
import { route } from '#lib/server/http/route.ts';

export const GET = route((app, event) =>
	handleExportDeck(app, event.params.id ?? '', event.url, event.locals.requestId)
);
