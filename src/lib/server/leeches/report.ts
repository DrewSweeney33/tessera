import {
	buildWeakSpotReport,
	type WeakSpotOptions,
	type WeakSpotReport
} from '#lib/core/weak-spots.ts';
import type { Db } from '../db/client.ts';
import { listLeeches, weakTags } from './index.ts';

// The weak-spot report for one deck or all (ADR-015): the leech cards that still need a rewrite, and the weakest
// tags. A suspended card is one the learner has dealt with, so it is not in it.
export function weakSpotReport(
	db: Db,
	options: {
		now: Date;
		schemaUrl: string;
		deck?: { id: string; title: string };
		report?: WeakSpotOptions;
	}
): WeakSpotReport {
	const deckId = options.deck?.id;
	const items = listLeeches(db, deckId === undefined ? {} : { deckId })
		.filter((leech) => !leech.suspended)
		.map((leech) => ({
			deckId: leech.deckId,
			deckTitle: leech.deckTitle,
			key: leech.key,
			ordinal: leech.ordinal,
			type: leech.type,
			content: leech.content,
			tags: leech.tags,
			source: leech.source,
			lapses: leech.lapses,
			reps: leech.reps,
			lastReviewedAt: leech.lastReviewedAt,
			wrongAnswers: leech.wrongAnswers
		}));
	return buildWeakSpotReport(
		{
			generatedAt: options.now.toISOString(),
			scope: options.deck ? { deckId: options.deck.id, deckTitle: options.deck.title } : {},
			schemaUrl: options.schemaUrl,
			items,
			tags: weakTags(db, { now: options.now, ...(deckId === undefined ? {} : { deckId }) })
		},
		options.report
	);
}
