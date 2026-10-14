// The weak-spot report (US-6, ADR-015): the cards a learner keeps failing, written so they can be pasted to Claude
// and the answer imported without edits. Pure: it takes the facts and returns the text, so every rule is tested.

import { compareText } from './compare.ts';

export interface ReportLeechItem {
	deckId: string;
	deckTitle: string;
	key: string;
	// 0 for a card, the blank number for a cloze card.
	ordinal: number;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	content: Record<string, unknown>;
	tags: string[];
	source: string | null;
	lapses: number;
	reps: number;
	lastReviewedAt: string | null;
	wrongAnswers: string[];
}

export interface ReportTag {
	tag: string;
	reviews: number;
	// The share of review-phase reviews graded Hard, Good, or Easy, from 0 to 1.
	retention: number;
	// The share graded Again, from 0 to 1.
	lapseRate: number;
	cards: number;
}

export interface WeakSpotInput {
	generatedAt: string;
	scope: { deckId?: string; deckTitle?: string };
	schemaUrl: string;
	items: ReportLeechItem[];
	tags: ReportTag[];
}

export interface WeakSpotOptions {
	maxCards?: number;
	maxChars?: number;
}

export const DEFAULT_MAX_CARDS = 40;
export const DEFAULT_MAX_CHARS = 60_000;

export interface ReportCardStats {
	id: string;
	type: string;
	lapses: number;
	reps: number;
	// For a cloze card, which blanks are leeches.
	blanks?: number[];
	wrongAnswers: string[];
	lastReviewedAt: string | null;
}

export interface ReportDeckBlock {
	// A deck document in the format import reads, holding only the leech cards.
	document: {
		tessera: 1;
		deck: { id: string; title: string };
		cards: Record<string, unknown>[];
	};
	stats: ReportCardStats[];
}

export interface WeakSpotReport {
	json: {
		report: 'tessera-weak-spots';
		version: 1;
		generatedAt: string;
		scope: { deckId: string | null };
		instruction: string;
		schemaUrl: string;
		leechCards: { total: number; shown: number; omitted: number; tooLarge: string[] };
		decks: ReportDeckBlock[];
		weakTags: ReportTag[];
		truncated: boolean;
	};
	markdown: string;
}

// What Claude is asked to do. Fixed text, so the same report always asks the same thing.
export const INSTRUCTION = [
	'These are flashcards I keep getting wrong in Tessera, a spaced repetition app. Please rewrite them so they are easier to learn.',
	'Good fixes: split a card that asks for two things, make the question specific so it has one right answer, add a memory hook or a short explanation, turn a list into cloze blanks, or turn a vague question into a typed one with accepted variants.',
	"Do not change a card's `id` or its `type`. The app matches your answer to my review history by id, and a new type erases that history.",
	'Reply with one code block per deck, in the same format as the block below: `tessera: 1`, the `deck` object exactly as given, and only the cards you revised. Leave out any card that is fine as it is. After each code block, say in a line what you changed in each card.'
].join('\n\n');

type Card = Record<string, unknown>;

interface Grouped {
	deckId: string;
	deckTitle: string;
	key: string;
	card: Card;
	stats: ReportCardStats;
	sortLapses: number;
	sortReviewed: string;
	size: number;
}

function cardOf(item: ReportLeechItem): Card {
	return {
		id: item.key,
		type: item.type,
		...item.content,
		...(item.tags.length > 0 ? { tags: item.tags } : {}),
		...(item.source ? { source: item.source } : {})
	};
}

function groupItems(items: ReportLeechItem[]): Grouped[] {
	const byCard = new Map<string, ReportLeechItem[]>();
	for (const item of items) {
		const id = `${item.deckId}/${item.key}`;
		byCard.set(id, [...(byCard.get(id) ?? []), item]);
	}
	return [...byCard.values()].map((blanks) => {
		const worst = [...blanks].sort((a, b) => b.lapses - a.lapses || a.ordinal - b.ordinal);
		const first = worst[0]!;
		const answers: string[] = [];
		for (const blank of worst) {
			for (const answer of blank.wrongAnswers) if (!answers.includes(answer)) answers.push(answer);
		}
		const reviewed = blanks
			.map((blank) => blank.lastReviewedAt ?? '')
			.reduce((latest, at) => (at > latest ? at : latest), '');
		const card = cardOf(first);
		const stats: ReportCardStats = {
			id: first.key,
			type: first.type,
			lapses: first.lapses,
			reps: Math.max(...blanks.map((blank) => blank.reps)),
			...(first.type === 'cloze'
				? { blanks: blanks.map((blank) => blank.ordinal).sort((a, b) => a - b) }
				: {}),
			wrongAnswers: answers.slice(0, 5),
			lastReviewedAt: reviewed === '' ? null : reviewed
		};
		return {
			deckId: first.deckId,
			deckTitle: first.deckTitle,
			key: first.key,
			card,
			stats,
			sortLapses: first.lapses,
			sortReviewed: reviewed,
			// The card as it is printed, and a line of room for its facts.
			size: JSON.stringify(card, null, 2).length + 240
		};
	});
}

const percent = (share: number) => `${Math.round(share * 100)}%`;
const cell = (text: string) => text.replace(/[|\r\n]+/g, ' ').trim();

function statsLine(stats: ReportCardStats): string {
	const kind = stats.blanks
		? `cloze, blank${stats.blanks.length === 1 ? '' : 's'} ${stats.blanks.join(', ')}`
		: stats.type;
	const wrong =
		stats.wrongAnswers.length > 0
			? ` Wrong answers I typed: ${stats.wrongAnswers.map((answer) => JSON.stringify(answer)).join(', ')}.`
			: '';
	return `- \`${stats.id}\` (${kind}): ${stats.lapses} lapses, ${stats.reps} reviews.${wrong}`;
}

export function buildWeakSpotReport(
	input: WeakSpotInput,
	options: WeakSpotOptions = {}
): WeakSpotReport {
	const maxCards = options.maxCards ?? DEFAULT_MAX_CARDS;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

	const cards = groupItems(input.items).sort(
		(a, b) =>
			b.sortLapses - a.sortLapses ||
			compareText(b.sortReviewed, a.sortReviewed) ||
			compareText(a.deckId, b.deckId) ||
			compareText(a.key, b.key)
	);

	// Worst first. A card never gets cut: it goes in whole, or it is counted as left out.
	const chosen: Grouped[] = [];
	const tooLarge: string[] = [];
	let used = 0;
	let full = false;
	let omitted = 0;
	for (const card of cards) {
		if (card.size > maxChars) {
			tooLarge.push(`${card.deckId}/${card.key}`);
		} else if (full || chosen.length >= maxCards || used + card.size > maxChars) {
			full = true;
			omitted++;
		} else {
			chosen.push(card);
			used += card.size;
		}
	}

	// Decks in the order of their worst card.
	const decks: ReportDeckBlock[] = [];
	const blockOf = new Map<string, ReportDeckBlock>();
	for (const card of chosen) {
		let block = blockOf.get(card.deckId);
		if (!block) {
			block = {
				document: { tessera: 1, deck: { id: card.deckId, title: card.deckTitle }, cards: [] },
				stats: []
			};
			blockOf.set(card.deckId, block);
			decks.push(block);
		}
		block.document.cards.push(card.card);
		block.stats.push(card.stats);
	}

	const truncated = omitted > 0 || tooLarge.length > 0;
	const json: WeakSpotReport['json'] = {
		report: 'tessera-weak-spots',
		version: 1,
		generatedAt: input.generatedAt,
		scope: { deckId: input.scope.deckId ?? null },
		instruction: INSTRUCTION,
		schemaUrl: input.schemaUrl,
		leechCards: { total: cards.length, shown: chosen.length, omitted, tooLarge },
		decks,
		weakTags: input.tags,
		truncated
	};

	const lines: string[] = [];
	const when = `${input.generatedAt.slice(0, 10)} ${input.generatedAt.slice(11, 16)} UTC`;
	lines.push('# Tessera weak-spot report', '');
	lines.push(
		`Generated ${when}. ${input.scope.deckId ? `Deck: ${input.scope.deckTitle ?? input.scope.deckId}` : 'All decks'}.`,
		''
	);

	if (cards.length === 0) {
		lines.push(
			'## Cards I keep getting wrong',
			'',
			'No cards are flagged as leeches right now, so there is nothing to rewrite. The tags below show where my recall is weakest.',
			''
		);
	} else {
		lines.push(
			'## What I would like you to do',
			'',
			INSTRUCTION,
			'',
			`Schema: ${input.schemaUrl}`,
			''
		);
		lines.push(
			`## Cards I keep getting wrong (${cards.length}${chosen.length < cards.length ? `, showing ${chosen.length}` : ''})`,
			''
		);
		for (const block of decks) {
			lines.push(`### ${cell(block.document.deck.title)} (\`${block.document.deck.id}\`)`, '');
			for (const stats of block.stats) lines.push(statsLine(stats));
			lines.push('', '```json', JSON.stringify(block.document, null, 2), '```', '');
		}
	}

	lines.push('## Weakest tags', '');
	if (input.tags.length === 0) {
		lines.push('No tag has enough reviews yet to say which is weakest.', '');
	} else {
		lines.push('For context. These are my weakest tags by recall over the last 90 days.', '');
		lines.push(
			'| Tag | Reviews | Retention | Lapse rate | Cards |',
			'| --- | --- | --- | --- | --- |'
		);
		for (const row of input.tags) {
			lines.push(
				`| ${cell(row.tag)} | ${row.reviews} | ${percent(row.retention)} | ${percent(row.lapseRate)} | ${row.cards} |`
			);
		}
		lines.push('');
	}

	if (truncated) {
		lines.push('## Left out', '');
		if (omitted > 0) {
			lines.push(
				`${omitted} more leech card${omitted === 1 ? ' is' : 's are'} not shown, to keep this short enough to paste. Fix these first, import the result, and ask for the report again.`,
				''
			);
		}
		if (tooLarge.length > 0) {
			lines.push(
				`These cards are too large to include (${tooLarge.map((id) => `\`${id}\``).join(', ')}). Edit them by hand in Tessera.`,
				''
			);
		}
	}

	return { json, markdown: `${lines.join('\n').trimEnd()}\n` };
}
