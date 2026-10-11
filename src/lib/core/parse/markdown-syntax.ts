// The line-level rules of the Markdown deck format, shared by the parser and the serializer so the two can
// never disagree about what a line means.
//
// A card starts at a "## id" heading. Inside a card a line that begins with a field label ("Q:", "Answer:")
// starts a field, and the field continues until the next label, heading, or the end of the file. Code
// fences are opaque: nothing inside one is a label or a heading.
//
// The format has one escape. A value line that would otherwise read as a label or heading is written with
// one backslash in front. The parser removes exactly one, so any text can be stored and read back unchanged.

export const LABEL_NAMES = [
	'type',
	'q',
	'a',
	'answer',
	'accept',
	'cloze',
	'choices',
	'explanation',
	'extra',
	'hint',
	'tags',
	'source'
] as const;
export type LabelName = (typeof LABEL_NAMES)[number];

const NAMES = LABEL_NAMES.join('|');
const LABEL_LINE = new RegExp(`^(${NAMES}):[ \\t]*(.*)$`, 'i');
const CARD_HEADING = /^##(?!#)[ \t]*(.*?)[ \t]*$/;
// A line that is a label or heading as written.
const SPECIAL_START = new RegExp(`^(?:(?:${NAMES}):|##(?!#))`, 'i');
// The same after one or more backslashes: the escaped form of a special line.
const ESCAPED_SPECIAL = new RegExp(`^\\\\+(?:(?:${NAMES}):|##(?!#))`, 'i');

export function matchLabel(line: string): { label: LabelName; rest: string } | undefined {
	const found = LABEL_LINE.exec(line);
	return found ? { label: found[1]!.toLowerCase() as LabelName, rest: found[2]! } : undefined;
}

// The id on a "## id" heading, or an empty string for a bare "##".
export function matchHeading(line: string): { id: string } | undefined {
	const found = CARD_HEADING.exec(line);
	return found ? { id: found[1]! } : undefined;
}

export function isEscapedSpecial(line: string): boolean {
	return ESCAPED_SPECIAL.test(line);
}

// "\Q: x" is the text "Q: x". Removes the one escaping backslash.
export function unescapeLine(line: string): string {
	return line.slice(1);
}

// True for a line that must be escaped to stay ordinary text: one that reads as a label or heading, or as
// an already escaped one (so that unescaping it later gives back exactly what was written).
export function needsEscape(line: string): boolean {
	return SPECIAL_START.test(line) || ESCAPED_SPECIAL.test(line);
}

export function escapeLine(line: string): string {
	return needsEscape(line) ? `\\${line}` : line;
}

// ---- Code fences (CommonMark rules: three or more backticks or tildes, indented at most three spaces)

export interface FenceState {
	char: '`' | '~';
	length: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// The fence state after reading one more line. `state` is undefined outside a fence.
export function advanceFence(state: FenceState | undefined, line: string): FenceState | undefined {
	if (state) {
		const closer = new RegExp(`^ {0,3}\\${state.char}{${state.length},}[ \\t]*$`);
		return closer.test(line) ? undefined : state;
	}
	const open = FENCE_OPEN.exec(line);
	if (!open) return undefined;
	const marker = open[1]!;
	// An opening backtick fence may not have a backtick in its info text, or it is inline code.
	if (marker.startsWith('`') && open[2]!.includes('`')) return undefined;
	return { char: marker[0] as '`' | '~', length: marker.length };
}

// ---- Choices

// One choice: "- text", "- [ ] text", or "- [x] text" with the right one marked. "*" and "+" also work.
export const CHOICE_ITEM = /^[-*+][ \t]+(?:\[([ xX])\](?:[ \t]+|$))?(.*)$/;

// The text of a line inside a Choices list, without its bullet and marker or its two-space indent. Code
// fences inside a choice are tracked on this text, so one that opens on the first line of a choice
// (after the bullet) is a fence, just as it would be anywhere else.
export function choiceContent(line: string): string {
	const item = CHOICE_ITEM.exec(line);
	return item ? item[2]! : line.replace(/^(?: {1,2}|\t)/, '');
}

// An indented line under a choice continues that choice. A line there that reads as a field label ("Explanation:")
// is almost always a mistake: a formatter or a model indented what should start a field, and reading it as part
// of the choice would silently change the deck. So it is an error, unless it is escaped like any other line that
// looks like a label. The same one backslash is removed when reading and added when writing.
export function isIndentedLabel(content: string): boolean {
	return matchLabel(content) !== undefined;
}

export function escapeChoiceLine(content: string): string {
	return isIndentedLabel(content) || isEscapedSpecial(content) ? `\\${content}` : content;
}

// ---- Comma separated lists (Tags, Accept)

// Splits on commas and line breaks. "\," is a literal comma and "\\" a literal backslash. Items are
// trimmed and empty ones dropped.
export function splitList(value: string): string[] {
	const items: string[] = [];
	let current = '';
	for (let i = 0; i < value.length; i++) {
		const char = value[i]!;
		const next = value[i + 1];
		if (char === '\\' && (next === ',' || next === '\\')) {
			current += next;
			i++;
		} else if (char === ',' || char === '\n') {
			items.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	items.push(current);
	return items.map((item) => item.trim()).filter((item) => item !== '');
}

export function joinList(items: readonly string[]): string {
	return items.map((item) => item.replaceAll('\\', '\\\\').replaceAll(',', '\\,')).join(', ');
}
