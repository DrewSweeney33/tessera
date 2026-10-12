import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import type { AppContext } from '../app.ts';
import { errorResponse } from '../http/errors.ts';
import { exportDeck, renderDeckExport, type ExportFormat } from '../export/index.ts';

const FORMATS: Record<string, ExportFormat> = {
	json: 'json',
	md: 'markdown',
	markdown: 'markdown'
};

// GET /api/decks/:id/export?format=json|md (ADR-013). Sends the deck as a deck document, as a file download.
// What it sends, import accepts as no change at all, so a deck can be exported, edited, and imported again.
//
// An id that cannot be a deck id, an unknown deck, and a deck in the Trash all get the same 404, and the
// message only ever repeats an id that passed the id rules, so nothing a caller typed is echoed back.
export function handleExportDeck(
	app: AppContext,
	deckId: string,
	url: URL,
	requestId: string
): Response {
	const notFound = () =>
		errorResponse(
			'not_found',
			ID_PATTERN.test(deckId) ? `There is no deck "${deckId}".` : 'There is no such deck.',
			undefined,
			requestId
		);
	if (!ID_PATTERN.test(deckId)) return notFound();

	const requested = url.searchParams.get('format') ?? 'json';
	const format = Object.hasOwn(FORMATS, requested) ? FORMATS[requested] : undefined;
	if (format === undefined) {
		return errorResponse(
			'bad_request',
			'format must be json or md (markdown is also accepted).',
			undefined,
			requestId
		);
	}

	const deck = exportDeck(app.db, deckId);
	if (!deck) return notFound();

	const rendered = renderDeckExport(deck, format);
	if (!rendered.ok) {
		return errorResponse(
			'validation_failed',
			rendered.error.message,
			rendered.error.problems,
			requestId
		);
	}
	const headers = new Headers({
		'content-type': rendered.value.contentType,
		'content-disposition': `attachment; filename="${rendered.value.filename}"`,
		'cache-control': 'no-store'
	});
	if (requestId) headers.set('x-request-id', requestId);
	return new Response(rendered.value.body, { status: 200, headers });
}
