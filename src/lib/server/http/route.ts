import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { getApp, type AppContext } from '../app.ts';
import { AppError, errorResponse, toErrorResponse } from './errors.ts';

// Wraps an API handler: resolves the app context and turns thrown errors into the standard
// error shape. Expected failures (AppError) keep their code. Anything else is logged and hidden.
export function route(
	fn: (app: AppContext, event: RequestEvent) => Response | Promise<Response>
): RequestHandler {
	return async (event) => {
		const requestId = event.locals.requestId;
		try {
			return await fn(getApp(), event);
		} catch (error) {
			if (!(error instanceof AppError)) {
				getApp().log.error('unhandled error in route', {
					requestId,
					route: event.url.pathname,
					error: error instanceof Error ? error.message : String(error)
				});
			}
			return toErrorResponse(error, requestId);
		}
	};
}

export { AppError, errorResponse };
