// Checking a typed answer. The learner types an answer, the card has the expected one and an optional list
// of other accepted answers (abbreviations, alternative spellings). The result is a suggested grade. The
// learner can always override it, because a wrong suggestion must never be able to cost them progress.
//
// Normalization is deliberately light, so that two different answers never look the same:
//   - Unicode compatibility form (NFKC): fullwidth letters, ligatures, and composed or decomposed accents
//     compare equal.
//   - Case folded, with the German sharp s as "ss" and every Greek sigma alike.
//   - Runs of whitespace of any kind (tabs, line breaks, non-breaking spaces) become one space, and the ends
//     are trimmed.
//   - Sentence punctuation at the END is dropped: . , ; : ! ?
// Nothing inside the text is touched. "10.0.0.1" and "10001" stay different, so do "a-b" and "ab", and a
// command with its words in another order is not a match.

export type TypedGrade = 1 | 3;

export interface TypedMatch {
	correct: boolean;
	// The expected answer or accepted alternative that the input matched, as written on the card.
	matched: string | undefined;
	// Good when it matches, Again when it does not.
	suggestedGrade: TypedGrade;
}

const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

// The form two answers are compared in. Returns an empty string for input that is only space or punctuation.
export function normalizeTyped(input: string): string {
	const folded = input
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll('ß', 'ss')
		.replaceAll('ς', 'σ')
		.replace(/\s+/gu, ' ')
		.trim();
	// Dropping the punctuation can expose spaces before it ("route ."), so trim again.
	return folded.replace(TRAILING_PUNCTUATION, '').trim();
}

// Compares what was typed with the expected answer and the accepted alternatives.
export function matchTyped(
	typed: string,
	answer: string,
	accept: readonly string[] | undefined = []
): TypedMatch {
	const candidate = normalizeTyped(typed);
	// Nothing typed is never right, even for an answer that is itself only punctuation.
	if (candidate !== '') {
		for (const expected of [answer, ...accept]) {
			if (normalizeTyped(expected) === candidate) {
				return { correct: true, matched: expected, suggestedGrade: 3 };
			}
		}
	}
	return { correct: false, matched: undefined, suggestedGrade: 1 };
}
