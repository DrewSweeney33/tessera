import { parseJson } from '#lib/core/parse/index.ts';
import { LIMITS } from '#lib/core/schema/index.ts';
import type { AppContext } from '../app.ts';
import { readBodyText } from '../http/body.ts';
import { mediaType } from '../http/content-type.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { commitImport, planImport, type ImportPlan } from '../import/index.ts';

function flag(url: URL, name: string): boolean | Response {
	const value = url.searchParams.get(name);
	if (value === null) return false;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return errorResponse('bad_request', `Query parameter ${name} must be true or false.`);
}

// What the preview needs: counts, and every card that is not simply unchanged.
function summarizePlan(plan: ImportPlan) {
	return {
		deck: {
			id: plan.deck.id,
			title: plan.deck.title,
			action: plan.deck.action,
			changed: plan.deck.changed
		},
		counts: plan.counts,
		cards: plan.cards
			.filter((card) => card.action !== 'unchanged')
			.map((card) => ({
				key: card.key,
				index: card.index,
				action: card.action,
				changedFields: card.changedFields,
				restored: card.restored,
				generatedKey: card.generatedKey
			})),
		absent: plan.absent.map((card) => ({ key: card.key, archived: card.archived })),
		archiveMissing: plan.archiveMissing,
		warnings: plan.warnings
	};
}

// POST /api/import?dry_run=true&archive_missing=true&filename=deck.json
// The body is a deck in the Tessera JSON format. Content type is checked by the hook before this runs.
export async function handleImport(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const url = new URL(request.url);
	const dryRun = flag(url, 'dry_run');
	if (dryRun instanceof Response) return dryRun;
	const archiveMissing = flag(url, 'archive_missing');
	if (archiveMissing instanceof Response) return archiveMissing;
	const filename = url.searchParams.get('filename')?.slice(0, 255) || undefined;

	const type = mediaType(request.headers.get('content-type'));
	if (type !== 'application/json') {
		return errorResponse(
			'unsupported_media_type',
			'Only JSON decks can be imported right now. Send Content-Type: application/json.',
			{ accepted: ['application/json'] },
			requestId
		);
	}

	const body = await readBodyText(
		request,
		LIMITS.maxBodyBytes,
		`The deck is larger than ${LIMITS.maxBodyBytes / (1024 * 1024)} MB.`,
		requestId
	);
	if (body instanceof Response) return body;

	const parsed = parseJson(body);
	if (!parsed.ok) {
		const tooLarge = parsed.error[0]?.code === 'payload_too_large';
		return errorResponse(
			tooLarge ? 'payload_too_large' : 'validation_failed',
			tooLarge
				? parsed.error[0]!.message
				: 'The deck is not valid. Fix the listed problems and import again.',
			{ errors: parsed.error },
			requestId
		);
	}

	if (dryRun) {
		const planned = planImport(app.db, parsed.value, { archiveMissing });
		if (!planned.ok) {
			return errorResponse(
				'validation_failed',
				'The deck is not valid. Fix the listed problems and import again.',
				{ errors: planned.error },
				requestId
			);
		}
		return jsonResponse({ dryRun: true, plan: summarizePlan(planned.value) });
	}

	const committed = commitImport(
		app.db,
		parsed.value,
		{ archiveMissing, format: 'json', filename },
		app.clock
	);
	if (!committed.ok) {
		return errorResponse(
			'validation_failed',
			'The deck is not valid. Fix the listed problems and import again.',
			{ errors: committed.error },
			requestId
		);
	}
	app.log.info('import committed', {
		requestId,
		deckId: committed.value.deckId,
		changed: committed.value.changed,
		...committed.value.counts
	});
	return jsonResponse({ dryRun: false, result: committed.value });
}
