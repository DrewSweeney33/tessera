// Minimal cloze helpers needed to know which review items a cloze card produces.
// The full scanner (nesting, hints, rendering a card for one number) arrives with M2-01.
const MARKER = /\{\{c([1-9][0-9]?)::/g;

// The distinct cloze numbers in the text, ascending. {{c1::a}} and {{c1::b}} share number 1.
export function listClozeOrdinals(text: string): number[] {
	const found = new Set<number>();
	for (const match of text.matchAll(MARKER)) found.add(Number(match[1]));
	return [...found].sort((a, b) => a - b);
}
