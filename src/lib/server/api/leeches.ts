import type { LeechesResponse } from '#lib/core/api-types.ts';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { listLeeches, resetLeech, setCardSuspended, weakTags } from '../leeches/index.ts';
import { weakSpotReport } from '../leeches/report.ts';
import { getDeck } from '../repos/index.ts';

// Leeches and the weak-spot report over HTTP (US-6, ADR-015). The three small writes need no body.

function notFound(requestId: string, message = 'There is no such leech.'): Response {
	return errorResponse('not_found', message, undefined, requestId);
}

// A whole number as it appears in a path: digits only, short enough to be exact. Anything else is not an item.
function wholeNumber(text: string, maxDigits: number): number | undefined {
	return new RegExp(`^[0-9]{1,${maxDigits}}$`).test(text) ? Number(text) : undefined;
}

// The deck a request is limited to, if it names one that is in the deck list. A Response when it names none.
function scopeOf(
	app: AppContext,
	url: URL,
	requestId: string
): { id: string; title: string } | undefined | Response {
	const deckId = url.searchParams.get('deckId');
	if (deckId === null || deckId === '') return undefined;
	const deck = ID_PATTERN.test(deckId) ? getDeck(app.db, deckId) : undefined;
	if (!deck || deck.archived) return notFound(requestId, 'There is no such deck.');
	return { id: deck.id, title: deck.title };
}

// GET /api/leeches?deckId=
export function handleListLeeches(app: AppContext, url: URL, requestId = ''): Response {
	const scope = scopeOf(app, url, requestId);
	if (scope instanceof Response) return scope;
	const leeches = listLeeches(app.db, scope ? { deckId: scope.id } : {});
	const body: LeechesResponse = {
		leeches,
		weakTags: weakTags(app.db, { now: app.clock.now(), ...(scope ? { deckId: scope.id } : {}) }),
		openCount: leeches.filter((leech) => !leech.suspended).length
	};
	return jsonResponse(body);
}

// POST /api/leeches/:cardPk/:ordinal/reset
export function handleResetLeech(
	app: AppContext,
	cardPk: string,
	ordinal: string,
	requestId: string
): Response {
	const pk = wholeNumber(cardPk, 9);
	const blank = wholeNumber(ordinal, 3);
	if (pk === undefined || blank === undefined) return notFound(requestId);
	const result = resetLeech(app.db, pk, blank);
	if (!result.ok) return notFound(requestId);
	app.log.info('leech reset', { requestId, cardPk: pk, ordinal: blank });
	return jsonResponse({ reset: true });
}

// POST /api/cards/:cardPk/suspend and /unsuspend
export function handleSetSuspended(
	app: AppContext,
	cardPk: string,
	suspended: boolean,
	requestId: string
): Response {
	const pk = wholeNumber(cardPk, 9);
	if (pk === undefined) return notFound(requestId, 'There is no such card.');
	const result = setCardSuspended(app.db, pk, suspended);
	if (!result.ok) return notFound(requestId, 'There is no such card.');
	app.log.info(suspended ? 'card suspended' : 'card unsuspended', { requestId, cardPk: pk });
	return jsonResponse({ suspended });
}

const FORMATS: Record<string, 'md' | 'json'> = { md: 'md', markdown: 'md', json: 'json' };

// GET /api/report/weak-spots?format=md|json&deckId=
export function handleWeakSpotReport(app: AppContext, url: URL, requestId: string): Response {
	const requested = url.searchParams.get('format') ?? 'md';
	const format = Object.hasOwn(FORMATS, requested) ? FORMATS[requested] : undefined;
	if (!format) {
		return errorResponse(
			'bad_request',
			'format must be md (markdown is also accepted) or json.',
			undefined,
			requestId
		);
	}
	const scope = scopeOf(app, url, requestId);
	if (scope instanceof Response) return scope;

	const report = weakSpotReport(app.db, {
		now: app.clock.now(),
		schemaUrl: `${url.origin}/api/schema`,
		...(scope ? { deck: scope } : {})
	});
	const headers = { 'cache-control': 'no-store' };
	return format === 'json'
		? jsonResponse(report.json, { headers })
		: new Response(report.markdown, {
				headers: { ...headers, 'content-type': 'text/markdown; charset=utf-8' }
			});
}
