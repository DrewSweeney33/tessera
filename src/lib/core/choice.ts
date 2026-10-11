// Multiple choice cards. The deck lists the choices in the order the author wrote them and names the correct
// one by its position. What the learner sees is a shuffled order, so the answer is not always "the second
// one", but the shuffle must be the same every time the same card is shown, or a page refresh in the middle
// of a question would move the options. So the order comes from a seed, not from chance.

export type ChoiceGrade = 1 | 3;

export interface ChoiceResult {
	correct: boolean;
	// Good for the right choice, Again for a wrong one. The learner can override it.
	suggestedGrade: ChoiceGrade;
}

// A small, fast hash of text to a 32-bit number (FNV-1a).
function hashSeed(seed: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// A seeded random number generator (mulberry32): the same seed gives the same sequence on every machine.
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// The seed for one showing of one review item. It includes the number of reviews already done, so the
// order is stable while the question is open (and across a refresh) but changes the next time the item
// comes up, which stops the learner memorizing a position instead of the answer.
export function choiceSeed(cardPk: number, ordinal: number, reps: number): string {
	return `choice:${cardPk}:${ordinal}:${reps}`;
}

// A shuffled order for `count` choices. Position i of the result holds the index, in the author's order,
// of the choice to show there. The same seed always gives the same order.
export function shuffleChoices(count: number, seed: string): number[] {
	const order = Array.from({ length: Math.max(0, count) }, (_, i) => i);
	const random = seededRandom(hashSeed(seed));
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[order[i], order[j]] = [order[j]!, order[i]!];
	}
	return order;
}

// Grades the choice at one displayed position. `order` is what shuffleChoices returned for the card and
// `correct` is the author's index of the right choice. A position that does not exist is simply wrong.
export function gradeChoice(
	order: readonly number[],
	correct: number,
	selectedPosition: number
): ChoiceResult {
	const original = Number.isInteger(selectedPosition) ? order[selectedPosition] : undefined;
	const right = original !== undefined && original === correct;
	return { correct: right, suggestedGrade: right ? 3 : 1 };
}

// Where the right choice ends up on screen, so the interface can mark it after an answer.
export function positionOfCorrect(order: readonly number[], correct: number): number {
	return order.indexOf(correct);
}
