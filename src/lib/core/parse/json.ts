import { err, type Result } from '../result.ts';
import { validateDeck, type Deck } from '../schema/deck.ts';
import type { ImportError } from '../schema/errors.ts';
import { LIMITS } from '../schema/limits.ts';

// Claude often wraps JSON in a code fence. Accept that so a straight copy and paste works.
const FENCED = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/;

const SYNTAX_HINTS: [RegExp, string][] = [
	[
		/double-quoted property name/i,
		'A trailing comma, a single-quoted key, or an unquoted key is the usual cause. JSON needs double quotes and no trailing commas.'
	],
	[/property name or '}'/i, 'Keys must be in double quotes, and comments are not allowed in JSON.'],
	[/',' or/i, 'A comma is probably missing between two items.'],
	[/unterminated string/i, 'A string is missing its closing double quote.'],
	[
		/bad escaped character|bad control character/i,
		'A backslash or line break inside a string needs escaping.'
	]
];

function syntaxError(message: string, code: ImportError['code'], extra: Partial<ImportError> = {}) {
	return err([{ path: '(root)', code, message, ...extra }] satisfies ImportError[]);
}

function countNewlines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
	return count;
}

// Parses a JSON deck and validates it. Never throws for bad input.
export function parseJson(input: string): Result<Deck, ImportError[]> {
	if (new TextEncoder().encode(input).length > LIMITS.maxBodyBytes) {
		return syntaxError(
			`The deck is larger than the ${LIMITS.maxBodyBytes / (1024 * 1024)} MB limit. Split it into several smaller decks.`,
			'payload_too_large'
		);
	}

	// Editors on Windows often prepend a byte order mark (U+FEFF).
	let content = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	let lineOffset = 0;

	if (content.trim() === '') {
		return syntaxError('The input is empty. Paste a deck in the Tessera JSON format.', 'empty');
	}

	const fenced = FENCED.exec(content.trim());
	if (fenced) {
		const trimmed = content.trim();
		const start = content.indexOf(trimmed) + trimmed.indexOf('\n') + 1;
		lineOffset = countNewlines(content.slice(0, start));
		content = fenced[1] ?? '';
	}

	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		const trimmed = content.trim();

		// Output cut off right after a comma is reported at the end of the text, not as "unexpected end".
		const position = /at position (\d+)/.exec(message);
		const atEndOfText = position !== null && Number(position[1]) >= content.trimEnd().length;

		if (/unexpected end of json input/i.test(message) || atEndOfText) {
			return syntaxError(
				'The JSON ends before it is complete, so it was probably cut off. Check that every bracket is closed, or ask Claude to return the deck again, in smaller decks if it is long.',
				'truncated_json'
			);
		}
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
			const looksLikeMarkdown = trimmed.startsWith('---');
			return syntaxError(
				looksLikeMarkdown
					? 'This looks like the Markdown deck format, not JSON. Import it as Markdown.'
					: 'The text does not start with { so it is not a JSON deck. Remove any text before or after the JSON, such as an introduction from Claude.',
				looksLikeMarkdown ? 'not_json_is_markdown' : 'not_json'
			);
		}

		const located = /\(line (\d+) column (\d+)\)/.exec(message);
		const line = located ? Number(located[1]) + lineOffset : undefined;
		const column = located ? Number(located[2]) : undefined;
		const reason = message.split(' in JSON at position')[0]?.trim() ?? message;
		const hint = SYNTAX_HINTS.find(([pattern]) => pattern.test(message))?.[1];
		const where = line !== undefined ? ` at line ${line}, column ${column}` : '';

		return syntaxError(
			`Not valid JSON: ${reason}${where}.${hint ? ` ${hint}` : ''}`,
			'invalid_json',
			{
				...(line !== undefined ? { line } : {}),
				...(column !== undefined ? { column } : {})
			}
		);
	}

	return validateDeck(value);
}
