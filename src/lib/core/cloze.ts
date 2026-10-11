// Cloze cards. A blank is {{cN::answer}} or {{cN::answer::hint}}, with N from 1 to 99. Each number is a
// separate review item: the card is shown once per number, with that number hidden and the others shown.
//
// This is a small scanner, not a regular expression, so nested blanks, braces in ordinary text, and a
// missing closing marker behave predictably and are reported with a position. It runs in one pass over the
// text and keeps its own stack, so even hostile input (thousands of unclosed markers) cannot overflow the
// call stack or make it slow.

// Deepest nesting of blanks inside blanks that is accepted.
export const CLOZE_MAX_DEPTH = 8;
const MAX_REPORTED_ISSUES = 20;

export interface ClozeIssue {
	code: 'unclosed_cloze' | 'invalid_cloze_number' | 'empty_cloze' | 'cloze_too_deep';
	// Written to be pasted back to Claude and fixed.
	message: string;
	// Where the marker starts, as a character offset and as 1-based line and column.
	offset: number;
	line: number;
	column: number;
}

interface TextNode {
	kind: 'text';
	text: string;
}

interface BlankNode {
	kind: 'blank';
	// Undefined for a marker whose number is invalid. Such a blank is reported and renders as plain text.
	ordinal: number | undefined;
	children: ClozeNode[];
	hint: string | undefined;
	offset: number;
}

export type ClozeNode = TextNode | BlankNode;

interface Frame {
	blank: BlankNode;
	inHint: boolean;
	hint: string;
}

// {{c12:: with a valid number, and anything else that looks like an opener, to report a bad number.
const OPENER = /\{\{c([1-9][0-9]?)::/y;
const LOOKS_LIKE_OPENER = /\{\{c([^\s:{}]*)::/y;

function locate(text: string, offset: number): { line: number; column: number } {
	let line = 1;
	let lineStart = 0;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, column: offset - lineStart + 1 };
}

function plainText(nodes: readonly ClozeNode[]): string {
	return nodes
		.map((node) => (node.kind === 'text' ? node.text : plainText(node.children)))
		.join('');
}

// Reads the text into a tree of plain text and blanks, and reports every problem it finds. Never throws.
export function parseCloze(text: string): { nodes: ClozeNode[]; issues: ClozeIssue[] } {
	const root: ClozeNode[] = [];
	const stack: Frame[] = [];
	const issues: ClozeIssue[] = [];
	let buffer = '';
	let tooDeepReported = false;

	const report = (code: ClozeIssue['code'], offset: number, message: string) => {
		if (issues.length >= MAX_REPORTED_ISSUES) return;
		const { line, column } = locate(text, offset);
		issues.push({
			code,
			message: `${message} (line ${line}, column ${column})`,
			offset,
			line,
			column
		});
	};
	const currentNodes = (): ClozeNode[] => stack[stack.length - 1]?.blank.children ?? root;
	const flush = () => {
		if (buffer !== '') {
			currentNodes().push({ kind: 'text', text: buffer });
			buffer = '';
		}
	};
	const closeTop = (implicit: boolean) => {
		const frame = stack.pop()!;
		const { blank } = frame;
		if (frame.inHint) blank.hint = frame.hint.trim() || undefined;
		if (blank.ordinal !== undefined && !implicit && plainText(blank.children).trim() === '') {
			report(
				'empty_cloze',
				blank.offset,
				`the blank {{c${blank.ordinal}:: has no answer. Put the answer between :: and }}`
			);
		}
		currentNodes().push(blank);
	};

	let i = 0;
	while (i < text.length) {
		const top = stack[stack.length - 1];

		if (top?.inHint) {
			// A hint is plain text up to the closing marker.
			if (text.startsWith('}}', i)) {
				closeTop(false);
				i += 2;
			} else {
				top.hint += text[i];
				i++;
			}
			continue;
		}

		if (text.startsWith('{{c', i)) {
			OPENER.lastIndex = i;
			const valid = OPENER.exec(text);
			LOOKS_LIKE_OPENER.lastIndex = i;
			const looks = valid ? null : LOOKS_LIKE_OPENER.exec(text);
			const opener = valid ?? looks;
			if (opener) {
				if (stack.length >= CLOZE_MAX_DEPTH) {
					// Further openers are kept as ordinary text so the tree stays shallow.
					if (!tooDeepReported) {
						tooDeepReported = true;
						report(
							'cloze_too_deep',
							i,
							`blanks are nested more than ${CLOZE_MAX_DEPTH} deep. Simplify the card or split it into several`
						);
					}
					buffer += opener[0];
					i += opener[0].length;
					continue;
				}
				flush();
				if (!valid) {
					report(
						'invalid_cloze_number',
						i,
						`${opener[0]} is not a valid blank. The number after c must be from 1 to 99, as in {{c1::answer}}`
					);
				}
				stack.push({
					blank: {
						kind: 'blank',
						ordinal: valid ? Number(valid[1]) : undefined,
						children: [],
						hint: undefined,
						offset: i
					},
					inHint: false,
					hint: ''
				});
				i += opener[0].length;
				continue;
			}
		}

		if (top && text.startsWith('}}', i)) {
			flush();
			closeTop(false);
			i += 2;
			continue;
		}
		if (top && text.startsWith('::', i)) {
			// The first :: inside a blank starts its hint. Nested blanks have their own.
			flush();
			top.inHint = true;
			i += 2;
			continue;
		}

		buffer += text[i];
		i++;
	}

	flush();
	while (stack.length > 0) {
		const open = stack[stack.length - 1]!.blank;
		report(
			'unclosed_cloze',
			open.offset,
			`the blank ${open.ordinal === undefined ? 'marker' : `{{c${open.ordinal}::`} is never closed. Add }} after the answer`
		);
		closeTop(true);
	}
	return { nodes: root, issues };
}

// Problems with the markers in a cloze text, empty when it is well formed.
export function validateCloze(text: string): ClozeIssue[] {
	return parseCloze(text).issues;
}

function collectOrdinals(nodes: readonly ClozeNode[], into: Set<number>): void {
	for (const node of nodes) {
		if (node.kind !== 'blank') continue;
		if (node.ordinal !== undefined) into.add(node.ordinal);
		collectOrdinals(node.children, into);
	}
}

// The distinct cloze numbers in the text, ascending. {{c1::a}} and {{c1::b}} share number 1. Numbers
// inside nested blanks count, and so does a blank that was never closed.
export function listClozeOrdinals(text: string): number[] {
	const found = new Set<number>();
	collectOrdinals(parseCloze(text).nodes, found);
	return [...found].sort((a, b) => a - b);
}

const ELLIPSIS = '…';

// Markdown for the text with one number hidden or revealed. A blank with another number is shown as its
// answer. Blanks with a number the text could not use are shown as their content.
function render(nodes: readonly ClozeNode[], ordinal: number, reveal: boolean): string {
	let out = '';
	for (const node of nodes) {
		if (node.kind === 'text') {
			out += node.text;
		} else if (node.ordinal === ordinal) {
			out += reveal
				? `**${render(node.children, ordinal, true)}**`
				: `**[${node.hint ?? ELLIPSIS}]**`;
		} else {
			out += render(node.children, ordinal, reveal);
		}
	}
	return out;
}

// The question and the answer for one cloze number. In the question that number is hidden (shown as its
// hint, or as an ellipsis) and the other numbers are revealed. In the answer everything is shown and the
// asked number is bold.
export function clozeSides(text: string, ordinal: number): { front: string; back: string } {
	const { nodes } = parseCloze(text);
	return { front: render(nodes, ordinal, false), back: render(nodes, ordinal, true) };
}
