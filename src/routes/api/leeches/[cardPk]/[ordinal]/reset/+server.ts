import { handleResetLeech } from '#lib/server/api/leeches.ts';
import { route } from '#lib/server/http/route.ts';

export const POST = route((app, event) =>
	handleResetLeech(
		app,
		event.params.cardPk ?? '',
		event.params.ordinal ?? '',
		event.locals.requestId
	)
);
