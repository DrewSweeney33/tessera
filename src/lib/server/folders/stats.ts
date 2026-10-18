import type { FolderDto, FolderStatsDto } from '#lib/core/api-types.ts';
import { daysToExam } from '#lib/core/folder.ts';
import { studyDayKey, studyDayStart } from '#lib/core/study-day.ts';
import type { Db } from '../db/client.ts';
import type { FolderRow } from '../db/schema.ts';
import {
	countDecksByFolder,
	countFolderCards,
	getSettings,
	listFolders,
	reviewTotalsSince
} from '../repos/index.ts';
import { statsNumbers, type StatsContext } from '../stats/index.ts';
import { countQueue } from '../study/index.ts';

// A folder's numbers: what a session limited to it would serve, and what studying its decks has added up to
// (reviews, time, retention, streak, the last two weeks). Everything is read from the same tables as the rest of
// the app and limited to the decks that are in the folder and not in the Trash.

const DAY_MS = 86_400_000;

export type { StatsContext };

function share(remembered: number, total: number): number | null {
	return total === 0 ? null : remembered / total;
}

function todayStart(db: Db, context: StatsContext): string {
	return studyDayStart(context.now, context.timeZone, getSettings(db).rolloverHour).toISOString();
}

// The folder as the decks screen lists it.
export function summarizeFolder(
	db: Db,
	folder: FolderRow,
	context: StatsContext,
	numbers: { decks: number; cards: number }
): FolderDto {
	const since30 = new Date(context.now.getTime() - 30 * DAY_MS).toISOString();
	const today = reviewTotalsSince(db, { folderId: folder.id }, todayStart(db, context));
	const month = reviewTotalsSince(db, { folderId: folder.id }, since30);
	return {
		id: folder.id,
		name: folder.name,
		deckCount: numbers.decks,
		cardCount: numbers.cards,
		counts: countQueue(db, {
			scope: { folderId: folder.id },
			now: context.now,
			timeZone: context.timeZone
		}),
		reviewsToday: today.reviews,
		retention: share(month.retentionRemembered, month.retentionReviews),
		examDate: folder.examDate,
		daysToExam:
			folder.examDate === null
				? null
				: (daysToExam(
						folder.examDate,
						studyDayKey(context.now, context.timeZone, getSettings(db).rolloverHour)
					) ?? null)
	};
}

export function listFolderSummaries(db: Db, context: StatsContext): FolderDto[] {
	const deckCounts = countDecksByFolder(db);
	const cardCounts = countFolderCards(db);
	return listFolders(db).map((folder) =>
		summarizeFolder(db, folder, context, {
			decks: deckCounts.get(folder.id) ?? 0,
			cards: cardCounts.get(folder.id) ?? 0
		})
	);
}

export function folderSummary(db: Db, folder: FolderRow, context: StatsContext): FolderDto {
	return summarizeFolder(db, folder, context, {
		decks: countDecksByFolder(db).get(folder.id) ?? 0,
		cards: countFolderCards(db).get(folder.id) ?? 0
	});
}

// The full statistics of one folder (the same numbers the Statistics page shows for it).
export function folderStats(db: Db, folder: FolderRow, context: StatsContext): FolderStatsDto {
	return {
		folder: folderSummary(db, folder, context),
		...statsNumbers(db, { folderId: folder.id }, context)
	};
}
