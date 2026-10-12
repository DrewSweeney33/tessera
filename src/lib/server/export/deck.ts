import { err, ok, type Result } from '#lib/core/result.ts';
import { serializeJson, serializeMarkdown, type SerializeProblem } from '#lib/core/parse/index.ts';
import { FORMAT_VERSION, validateDeck, type Deck } from '#lib/core/schema/index.ts';
import type { Executor } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import { getDeck, listCardsForDeck } from '../repos/index.ts';

// A deck read back out of the database as a deck document, the inverse of import (ADR-013). Importing the
// result again changes nothing and creates nothing: every card keeps its id, its type, its text, its tags and
// source, and its place in the order. Cards that were removed (archived) are not in it. A deck in the Trash, or
// one that does not exist, has nothing to export, so the answer is the same for both and says nothing about
// which it was.
//
// A card that was imported without an id has the generated key it was stored under ("h-" and a hash). Exporting
// writes that key as its id, so the exported deck matches the stored cards and a later import keeps them.
export function exportDeck(x: Executor, deckId: string): Deck | undefined {
	const deck = getDeck(x, deckId);
	if (!deck || deck.archived) return undefined;

	const cards = listCardsForDeck(x, deckId)
		.filter((row) => !row.archived)
		.map((row) => ({
			id: row.key,
			type: row.type,
			...row.content,
			...(row.tags.length > 0 ? { tags: row.tags } : {}),
			...(row.source ? { source: row.source } : {})
		}));

	// A deck document must have at least one card (the public format, served at /api/schema), so a deck with none
	// has nothing it could export. Say so plainly: it is a state of the data, not a bug and not a bad request.
	if (cards.length === 0) {
		throw new AppError('conflict', 'This deck has no cards yet, so there is nothing to export.');
	}

	const checked = validateDeck({
		tessera: FORMAT_VERSION,
		deck: {
			id: deck.id,
			title: deck.title,
			...(deck.description ? { description: deck.description } : {}),
			...(deck.tags.length > 0 ? { tags: deck.tags } : {})
		},
		cards
	});
	// What is stored passed the same validation on the way in, so this is a bug, not a user error.
	if (!checked.ok) {
		throw new Error(
			`The stored deck "${deckId}" no longer validates: ${checked.error
				.slice(0, 3)
				.map((issue) => `${issue.path}: ${issue.message}`)
				.join('; ')}`
		);
	}
	return checked.value;
}

export type ExportFormat = 'json' | 'markdown';

export interface RenderedExport {
	body: string;
	contentType: string;
	// Safe for a header: a deck id is lower case letters, digits, and hyphens (the id rules).
	filename: string;
}

export interface ExportProblem {
	message: string;
	problems: SerializeProblem[];
}

export function renderDeckExport(
	deck: Deck,
	format: ExportFormat
): Result<RenderedExport, ExportProblem> {
	if (format === 'json') {
		return ok({
			body: serializeJson(deck),
			contentType: 'application/json; charset=utf-8',
			filename: `${deck.deck.id}.json`
		});
	}
	const markdown = serializeMarkdown(deck);
	if (!markdown.ok) {
		const first = markdown.error[0];
		return err({
			message:
				`This deck cannot be written as Markdown: ${first?.path ?? 'a card'} ${first?.message ?? 'has content the format cannot hold'}` +
				`${markdown.error.length > 1 ? ` (and ${markdown.error.length - 1} more)` : ''}. Export it as JSON instead, which can hold everything.`,
			problems: markdown.error
		});
	}
	return ok({
		body: markdown.value,
		contentType: 'text/markdown; charset=utf-8',
		filename: `${deck.deck.id}.md`
	});
}
