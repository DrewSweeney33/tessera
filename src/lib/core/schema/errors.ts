import type { z } from 'zod';
import { CARD_FIELDS, CARD_TYPES, type CardType } from './card.ts';
import { LIMITS } from './limits.ts';

// One problem in an import, written so it can be pasted back to Claude and fixed.
export interface ImportError {
	// Location such as "cards[12].back", or "(root)" for the whole document.
	path: string;
	// Stable machine-readable code such as "required" or "unknown_field".
	code: string;
	message: string;
	// Values or field names that would have been accepted, when that is a short list.
	allowed?: readonly (string | number)[];
	// 1-based line number, set by the parsers for syntax problems.
	line?: number;
	// 1-based column number, set for JSON syntax problems.
	column?: number;
}

type Issue = z.ZodError['issues'][number];
type Path = readonly PropertyKey[];

const DECK_ENVELOPE_FIELDS = ['tessera', 'deck', 'cards'];
const DECK_META_FIELDS = ['id', 'title', 'description', 'tags'];

export function formatPath(path: Path): string {
	let out = '';
	for (const segment of path) {
		if (typeof segment === 'number') out += `[${segment}]`;
		else out += out === '' ? String(segment) : `.${String(segment)}`;
	}
	return out === '' ? '(root)' : out;
}

function getAt(input: unknown, path: Path): unknown {
	let current: unknown = input;
	for (const segment of path) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<PropertyKey, unknown>)[segment];
	}
	return current;
}

function describeValue(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'an array';
	if (typeof value === 'string') return 'a string';
	if (typeof value === 'number') return 'a number';
	if (typeof value === 'boolean') return 'a boolean';
	if (value === undefined) return 'nothing';
	return 'an object';
}

function label(path: Path): string {
	const last = path[path.length - 1];
	return typeof last === 'string' ? last : formatPath(path);
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function allowedFieldsAt(input: unknown, path: Path): readonly string[] | undefined {
	if (path.length === 0) return DECK_ENVELOPE_FIELDS;
	if (path.length === 1 && path[0] === 'deck') return DECK_META_FIELDS;
	if (path.length === 2 && path[0] === 'cards') {
		const type = (getAt(input, path) as { type?: unknown } | undefined)?.type;
		if (typeof type === 'string' && (CARD_TYPES as readonly string[]).includes(type)) {
			return CARD_FIELDS[type as CardType];
		}
	}
	return undefined;
}

function mapIssue(issue: Issue, input: unknown): ImportError[] {
	const path = issue.path;
	const where = formatPath(path);
	const name = label(path);

	switch (issue.code) {
		case 'invalid_type': {
			const found = getAt(input, path);
			if (found === undefined) {
				return [{ path: where, code: 'required', message: `${name} is required` }];
			}
			// "type int" means nothing to a reader. A number with a fraction is the usual cause.
			const expected =
				issue.expected === 'int'
					? `a whole number, but found ${typeof found === 'number' ? found : describeValue(found)}`
					: `of type ${issue.expected}, but found ${describeValue(found)}`;
			return [
				{
					path: where,
					code: 'wrong_type',
					message: `${name} must be ${expected}`
				}
			];
		}
		case 'unrecognized_keys': {
			const allowed = allowedFieldsAt(input, path);
			return issue.keys.map((key) => ({
				path: formatPath([...path, key]),
				code: 'unknown_field',
				message: allowed
					? `unknown field "${key}". Allowed fields here: ${allowed.join(', ')}`
					: `unknown field "${key}"`,
				...(allowed ? { allowed } : {})
			}));
		}
		case 'invalid_union': {
			const options = (issue as { options?: readonly string[] }).options;
			if (options) {
				const found = getAt(input, path);
				const got = typeof found === 'string' ? `"${found}"` : 'a missing or non-text value';
				return [
					{
						path: where,
						code: 'invalid_value',
						message: `${name} must be one of: ${options.join(', ')} (found ${got})`,
						allowed: options
					}
				];
			}
			return [{ path: where, code: 'invalid', message: issue.message }];
		}
		case 'invalid_value': {
			if (path.length === 1 && path[0] === 'tessera') {
				const found = getAt(input, path);
				if (found === undefined) {
					return [
						{
							path: where,
							code: 'required',
							message: 'tessera is required: add "tessera": 1 at the top of the deck',
							allowed: [1]
						}
					];
				}
				return [
					{
						path: where,
						code: 'unsupported_version',
						message: `unsupported format version ${JSON.stringify(found)}: this importer reads "tessera": 1`,
						allowed: [1]
					}
				];
			}
			const values = issue.values.filter(
				(v): v is string | number => typeof v === 'string' || typeof v === 'number'
			);
			return [
				{
					path: where,
					code: 'invalid_value',
					message: `${name} must be one of: ${values.join(', ')}`,
					allowed: values
				}
			];
		}
		case 'too_small': {
			const found = getAt(input, path);
			const min = Number(issue.minimum);
			if (issue.origin === 'array') {
				const count = Array.isArray(found) ? found.length : 0;
				return [
					{
						path: where,
						code: 'too_few',
						message: `${name} needs at least ${plural(min, 'item')}, found ${count}`
					}
				];
			}
			return [{ path: where, code: 'too_small', message: issue.message }];
		}
		case 'too_big': {
			const found = getAt(input, path);
			const max = Number(issue.maximum);
			if (issue.origin === 'array') {
				const count = Array.isArray(found) ? found.length : 0;
				return [
					{
						path: where,
						code: 'too_many',
						message: `${name} allows at most ${plural(max, 'item')}, found ${count}`
					}
				];
			}
			if (issue.origin === 'string') {
				const length = typeof found === 'string' ? found.length : 0;
				const base = issue.message.startsWith('Too big')
					? `${name} is too long (maximum ${max} characters)`
					: issue.message;
				return [{ path: where, code: 'too_long', message: `${base}, found ${length}` }];
			}
			return [{ path: where, code: 'too_big', message: issue.message }];
		}
		case 'invalid_format':
			return [{ path: where, code: 'invalid_format', message: issue.message }];
		case 'custom': {
			const code = (issue.params as { errorCode?: unknown } | undefined)?.errorCode;
			return [
				{ path: where, code: typeof code === 'string' ? code : 'invalid', message: issue.message }
			];
		}
		default:
			return [{ path: where, code: 'invalid', message: issue.message }];
	}
}

// Orders object keys by the schema's own field order (tessera, deck, cards; type, front, back...)
// so errors read top to bottom like the document. Unknown keys sort after known ones.
function compareSegments(parent: Path, x: PropertyKey, y: PropertyKey, input: unknown): number {
	if (typeof x === 'number' && typeof y === 'number') return x - y;
	const order = allowedFieldsAt(input, parent) ?? [];
	const rank = (key: PropertyKey) => {
		const index = order.indexOf(String(key));
		return index === -1 ? order.length : index;
	};
	return rank(x) - rank(y) || (String(x) < String(y) ? -1 : 1);
}

function comparePaths(a: Path, b: Path, input: unknown): number {
	const length = Math.min(a.length, b.length);
	for (let i = 0; i < length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		if (x === y) continue;
		return compareSegments(a.slice(0, i), x, y, input);
	}
	return a.length - b.length;
}

// Converts Zod issues into ImportErrors, sorted by position and capped so a hopeless
// document does not produce a wall of text.
export function toImportErrors(issues: readonly Issue[], input: unknown): ImportError[] {
	const ordered = issues
		.map((issue, index) => ({ issue, index }))
		.sort((a, b) => comparePaths(a.issue.path, b.issue.path, input) || a.index - b.index);

	const all = ordered.flatMap(({ issue }) => mapIssue(issue, input));
	if (all.length <= LIMITS.maxReportedErrors) return all;

	const shown = all.slice(0, LIMITS.maxReportedErrors);
	shown.push({
		path: '(root)',
		code: 'too_many_errors',
		message: `${all.length - LIMITS.maxReportedErrors} more errors not shown. Fix the ones above and import again.`
	});
	return shown;
}
