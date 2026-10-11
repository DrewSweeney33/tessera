import type { AppContext } from '../app.ts';
import { jsonResponse } from '../http/response.ts';

function databaseResponds(app: AppContext): boolean {
	try {
		return app.database.sqlite.prepare('select 1 as ok').get() !== undefined;
	} catch {
		return false;
	}
}

// GET /healthz. Answers 200 only if the database responds, 503 otherwise.
export function handleHealth(app: AppContext): Response {
	const dbOk = databaseResponds(app);
	return jsonResponse(
		{ ok: dbOk, version: app.version, dbOk },
		{ status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
}
