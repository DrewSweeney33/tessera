import { z } from 'zod';
import { DeckFileSchema } from './deck.ts';

// The published JSON Schema (served at /api/schema and read by the Claude skill).
// Rules that JSON Schema cannot express, such as choice index range and duplicate ids,
// are still enforced by validateDeck and reported with path-level errors.
export function deckJsonSchema(): Record<string, unknown> {
	const schema = z.toJSONSchema(DeckFileSchema, { target: 'draft-2020-12', io: 'input' });
	return {
		...schema,
		title: 'Tessera deck, format version 1',
		description:
			'A flashcard deck for Tessera. Cards are basic, cloze, typed, or choice. All text fields are Markdown and may contain code fences and mermaid diagrams.'
	};
}
