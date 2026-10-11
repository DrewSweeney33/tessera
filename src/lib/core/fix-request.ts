import type { FieldErrorDto } from './api-types.ts';

// The message pasted back to Claude when a deck fails to import. It names the exact fields and
// says what to preserve, so one round trip fixes the deck (the core promise of Tessera).
export function buildFixRequest(errors: readonly FieldErrorDto[], origin: string): string {
	const lines = errors.map((error, index) => {
		const where =
			error.line !== undefined
				? `line ${error.line}${error.column !== undefined ? `, column ${error.column}` : ''}`
				: error.path;
		const allowed =
			error.allowed && error.allowed.length > 0 ? ` (allowed: ${error.allowed.join(', ')})` : '';
		return `${index + 1}. ${where} [${error.code}]: ${error.message}${allowed}`;
	});

	return [
		'My Tessera deck failed to import. Please fix the problems below and reply with the complete corrected deck as JSON only, in a single code block.',
		'',
		'Keep every card "id" unchanged so my review history is preserved. Do not add fields the format does not define.',
		`The format is described by the JSON Schema at ${origin.replace(/\/$/, '')}/api/schema`,
		'',
		'Problems:',
		...lines
	].join('\n');
}
