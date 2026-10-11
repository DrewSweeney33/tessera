import {
	sequence,
	type Handle,
	type HandleServerError,
	type ServerInit
} from '@sveltejs/kit/hooks';
import { closeApp, getApp, initApp } from '#lib/server/app.ts';
import { contentTypeGuard, requestLogging, securityHeaders } from '#lib/server/http/hooks.ts';

// Runs once at server start: loads and validates configuration, opens the database, runs migrations.
// A bad configuration fails here with a readable message instead of on the first request.
export const init: ServerInit = () => {
	initApp();
	// adapter-node emits this on SIGTERM and SIGINT before it exits.
	process.on('sveltekit:shutdown', () => closeApp());
};

// Order matters: logging wraps everything, security headers cover even rejected requests.
export const handle: Handle = sequence(requestLogging, securityHeaders, contentTypeGuard);

// Only genuinely unknown errors (bugs) are logged. Framework errors such as 404s are routine.
// The message sent to the client never includes internals.
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	try {
		getApp().log.error('unhandled server error', {
			requestId: event.locals.requestId,
			path: event.url.pathname,
			error: error instanceof Error ? error.message : String(error)
		});
	} catch {
		// The app may not be initialized if startup failed. Nothing more to do.
	}
	return { message: 'Something went wrong on the server.' };
};
