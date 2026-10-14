import type { FieldErrorDto } from './api-types.ts';
import type { DeckFormat } from './parse/detect.ts';

// Where a problem is: its line (and column) when known, otherwise its field path.
function locationOf(error: FieldErrorDto): string {
	if (error.line === undefined) return error.path;
	if (error.column === undefined) return `line ${error.line}`;
	return `line ${error.line}, column ${error.column}`;
}

// The message pasted back to Claude when a deck fails to import. It names the exact fields and
// says what to preserve, so one round trip fixes the deck (the core promise of Tessera).
// `format` is the one the deck was written in, so the corrected deck comes back in the same one and the line
// numbers below still mean something.
export function buildFixRequest(
	errors: readonly FieldErrorDto[],
	origin: string,
	format: DeckFormat = 'json'
): string {
	const lines = errors.map((error, index) => {
		const allowed =
			error.allowed && error.allowed.length > 0 ? ` (allowed: ${error.allowed.join(', ')})` : '';
		return `${index + 1}. ${locationOf(error)} [${error.code}]: ${error.message}${allowed}`;
	});

	const schema = `${origin.replace(/\/$/, '')}/api/schema`;
	const markdown = format === 'markdown';

	return [
		markdown
			? 'My Tessera deck failed to import. Please fix the problems below and reply with the complete corrected deck in the Tessera Markdown format, nothing else, in a single code block. Use four backticks for the outer fence if the deck contains code blocks.'
			: 'My Tessera deck failed to import. Please fix the problems below and reply with the complete corrected deck as JSON only, in a single code block.',
		'',
		'Keep every card "id" unchanged so my review history is preserved. Do not add fields the format does not define.',
		markdown
			? `The fields are described by the JSON Schema at ${schema}. The Markdown format uses the same fields: a block at the top with tessera, id, and title, then a "## card-id" heading for each card with labels such as Q:, A:, Answer:, Cloze:, and Choices:.`
			: `The format is described by the JSON Schema at ${schema}`,
		'',
		'Problems:',
		...lines
	].join('\n');
}
