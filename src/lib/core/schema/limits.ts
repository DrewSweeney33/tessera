// Import limits from ADR-002 and the spec. Shared by the schema, the parsers, and the HTTP layer.
export const LIMITS = {
	maxBodyBytes: 5 * 1024 * 1024,
	maxCards: 5000,
	maxTextLength: 20_000,
	maxTitleLength: 200,
	maxDescriptionLength: 2000,
	maxSourceLength: 200,
	maxTags: 32,
	maxTagLength: 40,
	minChoices: 2,
	maxChoices: 8,
	maxChoiceLength: 2000,
	maxAccept: 20,
	maxAcceptLength: 500,
	maxIdLength: 64,
	maxReportedErrors: 50
} as const;

// Deck and card ids: lowercase letters, digits, and hyphens, starting with a letter or digit.
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ID_MESSAGE =
	'must start with a lowercase letter or digit and use only lowercase letters, digits, and hyphens (maximum 64 characters)';

// A tag has no commas (Markdown lists tags comma separated) and no leading or trailing whitespace.
export const TAG_PATTERN = /^[^,\s](?:[^,\r\n]*[^,\s])?$/;
export const TAG_MESSAGE =
	'must not contain commas or line breaks, and must not start or end with whitespace';

// A cloze marker is {{cN::answer}} with N from 1 to 99.
export const CLOZE_MARKER_PATTERN = /\{\{c[1-9][0-9]?::/;
