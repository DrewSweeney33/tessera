import { count, max } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { cards, decks, reviewLog } from '../db/schema.ts';

export interface LiveSummary {
	decks: number;
	cards: number;
	reviews: number;
	newestReviewAt: string | null;
}

// What the live database holds, in the same terms as the summary of a backup file.
export function summarizeLive(x: Executor): LiveSummary {
	const total = (table: typeof decks | typeof cards | typeof reviewLog) =>
		x.select({ n: count() }).from(table).get()?.n ?? 0;
	return {
		decks: total(decks),
		cards: total(cards),
		reviews: total(reviewLog),
		newestReviewAt:
			x
				.select({ at: max(reviewLog.reviewedAt) })
				.from(reviewLog)
				.get()?.at ?? null
	};
}
