import type { StatsScopeDto } from '#lib/core/api-types.ts';
import type { AppContext } from '../app.ts';
import { jsonResponse } from '../http/response.ts';
import { getDeck, getFolder } from '../repos/index.ts';
import { scopeStats } from '../stats/index.ts';
import { sessionScope } from './study.ts';

// GET /api/stats?deckId= or ?folderId= : the numbers behind the Statistics page for every deck (neither), one deck,
// or the decks in one folder (ADR-017). Read only. Naming both a deck and a folder is a 400, an unknown one a 404.
export function handleStats(app: AppContext, url: URL, requestId: string): Response {
	const scope = sessionScope(
		app,
		url.searchParams.get('deckId'),
		url.searchParams.get('folderId'),
		requestId
	);
	if (scope instanceof Response) return scope;
	let label: StatsScopeDto;
	if (scope.folderId !== undefined) {
		label = {
			kind: 'folder',
			id: scope.folderId,
			label: getFolder(app.db, scope.folderId)?.name ?? 'Folder'
		};
	} else if (scope.deckId !== undefined) {
		label = {
			kind: 'deck',
			id: scope.deckId,
			label: getDeck(app.db, scope.deckId)?.title ?? scope.deckId
		};
	} else {
		label = { kind: 'all', id: null, label: 'All decks' };
	}
	return jsonResponse(
		scopeStats(app.db, scope, label, { now: app.clock.now(), timeZone: app.config.timeZone })
	);
}
