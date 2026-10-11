// Minimal cloze helpers needed to know which review items a cloze card produces.
// The full scanner (nesting, hints, rendering a card for one number) arrives with M2-01.
const MARKER = /\{\{c([1-9][0-9]?)::/g;

// A blank is {{cN::answer}} or {{cN::answer::hint}}. This interim, non-nested version lets the study
// screen show cloze cards now. M2-01 replaces it with a scanner that handles nesting.
const BLANK = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

// The question and the answer for one cloze number. In the question that number is hidden (shown as
// [hint] or […]) and the other numbers are revealed. In the answer everything is shown and the
// asked number is bold.
export function clozeSides(text: string, ordinal: number): { front: string; back: string } {
	return {
		front: text.replace(BLANK, (_all, n: string, answer: string, hint?: string) =>
			Number(n) === ordinal ? `**[${hint?.trim() || '…'}]**` : answer
		),
		back: text.replace(BLANK, (_all, n: string, answer: string) =>
			Number(n) === ordinal ? `**${answer}**` : answer
		)
	};
}

// The distinct cloze numbers in the text, ascending. {{c1::a}} and {{c1::b}} share number 1.
export function listClozeOrdinals(text: string): number[] {
	const found = new Set<number>();
	for (const match of text.matchAll(MARKER)) found.add(Number(match[1]));
	return [...found].sort((a, b) => a - b);
}
