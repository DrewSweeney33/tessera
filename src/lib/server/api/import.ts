import { parseJson, parseMarkdown } from '#lib/core/parse/index.ts';
import { LIMITS, type Deck, type ImportError } from '#lib/core/schema/index.ts';
import type { Result } from '#lib/core/result.ts';
import type { AppContext } from '../app.ts';
import { readBodyText } from '../http/body.ts';
import { mediaType } from '../http/content-type.ts';
import { staleRevisionProblem } from '../decks/index.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import type { FieldChangeDto, ImportPlanSummary } from '#lib/core/api-types.ts';
import { commitImport, planImport, type FieldChange, type ImportPlan } from '../import/index.ts';

// Both readers end in the same validator, so a deck means the same thing whichever way it arrives.
// A Map, not an object, so a content type such as "constructor" can never match an inherited name.
const READERS = new Map<
	string,
	{ format: 'json' | 'markdown'; parse: (text: string) => Result<Deck, ImportError[]> }
>([
	['application/json', { format: 'json', parse: parseJson }],
	['text/markdown', { format: 'markdown', parse: parseMarkdown }]
]);

function flag(url: URL, name: string): boolean | Response {
	const value = url.searchParams.get(name);
	if (value === null) return false;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return errorResponse('bad_request', `Query parameter ${name} must be true or false.`);
}

// Changed cards beyond this many are listed without their old and new text, and the page shows the same
// number, so a deck of thousands of edits does not produce a huge reply.
const PREVIEW_DIFFS = 50;
const PREVIEW_ABSENT = 200;
const CUT_AT = 300;

function cut(value: string | undefined): { text: string | undefined; cut: boolean } {
	if (value === undefined || value.length <= CUT_AT) return { text: value, cut: false };
	return { text: value.slice(0, CUT_AT), cut: true };
}

function summarizeChanges(changes: FieldChange[]): FieldChangeDto[] {
	return changes.map((change) => {
		const before = cut(change.before);
		const after = cut(change.after);
		return {
			field: change.field,
			before: before.text,
			after: after.text,
			cut: before.cut || after.cut
		};
	});
}

// What the preview needs: counts, and every card that is not simply unchanged.
function summarizePlan(plan: ImportPlan): ImportPlanSummary {
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
			.map((card, position) => ({
				key: card.key,
				index: card.index,
				action: card.action,
				changedFields: card.changedFields,
				changes: position < PREVIEW_DIFFS ? summarizeChanges(card.changes) : undefined,
				progressLost: card.progressLost,
				restored: card.restored,
				generatedKey: card.generatedKey
			})),
		absent: plan.absent
			.slice(0, PREVIEW_ABSENT)
			.map((card) => ({ key: card.key, archived: card.archived })),
		archiveMissing: plan.archiveMissing,
		warnings: plan.warnings
	};
}

// A save from an old copy of the deck: 409, with the problem shaped like every other field error.
function staleResponse(problem: ImportError, requestId: string): Response {
	return errorResponse('conflict', problem.message, { errors: [problem] }, requestId);
}

// POST /api/import?dry_run=true&archive_missing=true&filename=deck.json
// The body is a deck in the Tessera JSON format (application/json) or Markdown format (text/markdown).
// The hook has already refused any other content type; the check here keeps this safe on its own.
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
	// The deck revision an editor loaded (ADR-013), so a save from an old copy is refused.
	const revisionParam = url.searchParams.get('expected_revision');
	if (revisionParam !== null && !/^[0-9a-f]{64}$/.test(revisionParam)) {
		return errorResponse(
			'bad_request',
			'Query parameter expected_revision must be the 64 character revision a deck was loaded with.',
			undefined,
			requestId
		);
	}
	const expectedRevision = revisionParam ?? undefined;

	// The client states the format. The server does not guess from the body.
	const reader = READERS.get(mediaType(request.headers.get('content-type')));
	if (!reader) {
		return errorResponse(
			'unsupported_media_type',
			'Send the deck with Content-Type: application/json or text/markdown.',
			{ accepted: [...READERS.keys()] },
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

	const parsed = reader.parse(body);
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
		if (expectedRevision !== undefined) {
			const stale = staleRevisionProblem(app.db, parsed.value.deck.id, expectedRevision);
			if (stale) return staleResponse(stale, requestId);
		}
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
		{ archiveMissing, format: reader.format, filename, expectedRevision },
		app.clock
	);
	if (!committed.ok) {
		const stale = committed.error.find((problem) => problem.code === 'changed_elsewhere');
		if (stale) return staleResponse(stale, requestId);
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
