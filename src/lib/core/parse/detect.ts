// Which format a pasted or dropped deck is in. The import page uses this to pick the content type, so an
// author never has to say. The server does not guess: an API client states the format it sends.
//
// The text decides, because that is what is about to be read. The file name only breaks a tie.

export type DeckFormat = 'json' | 'markdown';

const FENCE_LINE = /^(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*$/;

// The first line with text on it, skipping one code fence line, since a deck copied from a chat is often
// wrapped in one.
function firstLine(text: string): string {
	const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const lines = content.split(/\r?\n/);
	let seen = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') continue;
		if (seen === 0 && FENCE_LINE.test(trimmed)) {
			seen++;
			continue;
		}
		return trimmed;
	}
	return '';
}

export function detectFormat(text: string, filename?: string): DeckFormat {
	const first = firstLine(text);
	if (first.startsWith('{') || first.startsWith('[')) return 'json';
	if (first === '---') return 'markdown';

	// Text such as an introduction from Claude may come first. Look for the deck's own marker.
	if (/^tessera:[ \t]*\d/m.test(text)) return 'markdown';
	if (/"tessera"[ \t]*:/.test(text)) return 'json';

	const extension = /\.([A-Za-z0-9]+)$/.exec(filename ?? '')?.[1]?.toLowerCase();
	if (extension === 'md' || extension === 'markdown') return 'markdown';
	if (extension === 'json') return 'json';

	// Nothing says. JSON is the primary format, and its message for text that is not a deck asks for the
	// stray text to be removed, which is the likeliest fix.
	return 'json';
}

export const CONTENT_TYPES: Record<DeckFormat, string> = {
	json: 'application/json',
	markdown: 'text/markdown'
};
