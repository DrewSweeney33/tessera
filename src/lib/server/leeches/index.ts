import { compareText } from '#lib/core/compare.ts';
import { err, ok, type Result } from '#lib/core/result.ts';
import type { Db } from '../db/client.ts';
import {
	clearLeech,
	countOpenLeeches,
	findLiveCard,
	findLiveItem,
	reviewStatsByCard,
	selectLeechRows,
	setSuspended,
	wrongTypedAnswers,
	type LeechRow
} from '../repos/index.ts';

// Leeches (US-6, ADR-015): review items the learner keeps failing. They are flagged, never suspended by themselves.
// This is where they are listed with the wrong answers typed, and where the two things a learner does with one are:
// reset it (after fixing the card by hand) or suspend the card.

const SHOWN_WRONG_ANSWERS = 5;
const MAX_ANSWER_LENGTH = 200;

export interface LeechItem extends Omit<LeechRow, 'lastReview'> {
	lastReviewedAt: string | null;
	// The wrong answers typed for this item, newest first, without repeats.
	wrongAnswers: string[];
}

// The wrong answers shown for an item: trimmed, blanks dropped, cut to a length that fits a prompt, each shown once.
function shownAnswers(raw: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const answer of raw) {
		const cleaned = answer.trim().slice(0, MAX_ANSWER_LENGTH);
		if (cleaned === '' || seen.has(cleaned)) continue;
		seen.add(cleaned);
		out.push(cleaned);
		if (out.length === SHOWN_WRONG_ANSWERS) break;
	}
	return out;
}

export function listLeeches(db: Db, options: { deckId?: string } = {}): LeechItem[] {
	return selectLeechRows(db, options).map(({ lastReview, ...row }) => ({
		...row,
		lastReviewedAt: lastReview,
		wrongAnswers: shownAnswers(wrongTypedAnswers(db, row.cardPk, row.ordinal))
	}));
}

export function countLeeches(db: Db, options: { deckId?: string; folderId?: number } = {}): number {
	return countOpenLeeches(db, options);
}

export type LeechProblem = { kind: 'not_found' };

// Clears an item's leech flag and its lapse count. Nothing else changes. Doing it again is not an error.
export function resetLeech(db: Db, cardPk: number, ordinal: number): Result<true, LeechProblem> {
	if (!findLiveItem(db, cardPk, ordinal)) return err({ kind: 'not_found' });
	clearLeech(db, cardPk, ordinal);
	return ok(true);
}

// Suspends a card (every review item of it leaves the queue and the counts) or puts it back.
export function setCardSuspended(
	db: Db,
	cardPk: number,
	suspended: boolean
): Result<true, LeechProblem> {
	if (!findLiveCard(db, cardPk)) return err({ kind: 'not_found' });
	setSuspended(db, cardPk, suspended);
	return ok(true);
}

export interface WeakTag {
	tag: string;
	reviews: number;
	// The share of review-phase reviews graded Hard, Good, or Easy, from 0 to 1.
	retention: number;
	// The share graded Again.
	lapseRate: number;
	// How many cards with this tag were reviewed in the window.
	cards: number;
}

const DAY_MS = 86_400_000;

// The tags the learner remembers least, from the review log. A tag needs a minimum number of reviews before it is
// ranked, so two bad reviews do not make a weak tag. Weakest first, then the one with more reviews, then by name.
export function weakTags(
	db: Db,
	options: {
		now: Date;
		windowDays?: number;
		minReviews?: number;
		limit?: number;
		deckId?: string;
		folderId?: number;
	}
): WeakTag[] {
	const windowDays = options.windowDays ?? 90;
	const minReviews = options.minReviews ?? 10;
	const limit = options.limit ?? 10;
	const sinceIso = new Date(options.now.getTime() - windowDays * DAY_MS).toISOString();

	const totals = new Map<string, { reviews: number; remembered: number; cards: number }>();
	for (const card of reviewStatsByCard(db, {
		sinceIso,
		...(options.deckId === undefined ? {} : { deckId: options.deckId }),
		...(options.folderId === undefined ? {} : { folderId: options.folderId })
	})) {
		for (const tag of new Set(card.tags)) {
			const total = totals.get(tag) ?? { reviews: 0, remembered: 0, cards: 0 };
			total.reviews += card.reviews;
			total.remembered += card.remembered;
			total.cards += 1;
			totals.set(tag, total);
		}
	}

	return [...totals.entries()]
		.filter(([, total]) => total.reviews >= minReviews)
		.map(([tag, total]) => ({
			tag,
			reviews: total.reviews,
			retention: total.remembered / total.reviews,
			lapseRate: (total.reviews - total.remembered) / total.reviews,
			cards: total.cards
		}))
		.sort((a, b) => a.retention - b.retention || b.reviews - a.reviews || compareText(a.tag, b.tag))
		.slice(0, limit);
}
