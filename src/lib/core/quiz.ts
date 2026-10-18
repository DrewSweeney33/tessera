// Quiz me (ADR-020): the pure rules for turning a basic or typed card into a multiple choice question for Practice
// again. A question is the right answer plus three wrong ones taken from other cards' answers, in an order that is the
// same every time for the same seed, so a reload or a resumed session shows the same question. Nothing here reads or
// writes anything: the server gathers the answers and calls buildQuiz.

// An option is one line and at most this long, so it reads as an option and not as a paragraph.
export const MAX_ANSWER_LENGTH = 160;
// The wrong options shown with the right one.
export const WRONG_OPTIONS = 3;

// The text of the right answer of a card that can be quizzed: the back of a basic card, the answer of a typed card.
// Any other type has none (a cloze card is a blank to fill, and a choice card already is a question).
export function quizAnswerOf(card: {
	type: string;
	content: Record<string, unknown>;
}): string | undefined {
	const value =
		card.type === 'basic'
			? card.content['back']
			: card.type === 'typed'
				? card.content['answer']
				: undefined;
	return typeof value === 'string' ? value : undefined;
}

// An answer that can be an option: not empty, one line, short.
export function usableAnswer(text: unknown): text is string {
	if (typeof text !== 'string') return false;
	const trimmed = text.trim();
	return trimmed !== '' && !/[\r\n]/.test(trimmed) && trimmed.length <= MAX_ANSWER_LENGTH;
}

// What makes two answers "the same" for the purpose of showing both: ignoring case and runs of spaces.
export function answerKey(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// A small deterministic generator (mulberry32) seeded from a string (FNV-1a), so the same seed always gives the same
// sequence. Not for security: it only decides the order of options.
export function seededRandom(seed: string): () => number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	let state = hash >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// A shuffled copy (Fisher-Yates). The original is not changed.
export function seededShuffle<T>(items: readonly T[], random: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

export interface QuizQuestion {
	// The right answer and the wrong ones, in the order they are shown.
	options: string[];
	// Where the right answer is in `options`.
	correctIndex: number;
}

// The usable answers of a pool, trimmed, one for each distinct answer, and none that equals a taken one. Sorted by
// their text first so the result does not depend on the order the pool was read in.
function distinctUsable(pool: readonly string[], taken: Set<string>): string[] {
	const found = new Map<string, string>();
	for (const answer of pool) {
		if (!usableAnswer(answer)) continue;
		const key = answerKey(answer);
		if (taken.has(key) || found.has(key)) continue;
		found.set(key, answer.trim());
	}
	for (const key of found.keys()) taken.add(key);
	return [...found.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.map(([, text]) => text);
}

// Builds the question for one card, or says it cannot be built (undefined): the right answer is not usable, or there
// are fewer than three usable wrong answers. Wrong answers come from `sameDeck` first and from `others` only when the
// deck does not have enough, so a question about a CCNA card is mostly answered with other CCNA answers. The seed
// decides which wrong answers are taken and the order of all four, and nothing else does.
export function buildQuiz(args: {
	correct: string;
	sameDeck: readonly string[];
	others: readonly string[];
	seed: string;
}): QuizQuestion | undefined {
	if (!usableAnswer(args.correct)) return undefined;
	const correct = args.correct.trim();
	const taken = new Set([answerKey(correct)]);
	const near = distinctUsable(args.sameDeck, taken);
	const far = distinctUsable(args.others, taken);

	const random = seededRandom(args.seed);
	const wrong = [...seededShuffle(near, random), ...seededShuffle(far, random)].slice(
		0,
		WRONG_OPTIONS
	);
	if (wrong.length < WRONG_OPTIONS) return undefined;

	const options = seededShuffle([correct, ...wrong], random);
	return { options, correctIndex: options.indexOf(correct) };
}
