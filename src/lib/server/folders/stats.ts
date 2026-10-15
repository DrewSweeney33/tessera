import type { FolderDto, FolderStatsDto } from '#lib/core/api-types.ts';
import { dailyTotals, streakLength, type DayConfig } from '#lib/core/folder-stats.ts';
import { studyDayStart } from '#lib/core/study-day.ts';
import type { Db } from '../db/client.ts';
import type { FolderRow } from '../db/schema.ts';
import {
	countDecksByFolder,
	countFolderCards,
	countFolderItems,
	getSettings,
	listFolders,
	listReviewPointsSince,
	reviewTotalsSince
} from '../repos/index.ts';
import { countLeeches, weakTags } from '../leeches/index.ts';
import { countQueue } from '../study/index.ts';

// A folder's numbers: what a session limited to it would serve, and what studying its decks has added up to
// (reviews, time, retention, streak, the last two weeks). Everything is read from the same tables as the rest of
// the app and limited to the decks that are in the folder and not in the Trash.

const DAY_MS = 86_400_000;
const STREAK_LOOKBACK_DAYS = 400;
const CHART_DAYS = 14;

export interface StatsContext {
	now: Date;
	timeZone: string;
}

function share(remembered: number, total: number): number | null {
	return total === 0 ? null : remembered / total;
}

function dayConfig(db: Db, context: StatsContext): DayConfig {
	return { timeZone: context.timeZone, rolloverHour: getSettings(db).rolloverHour };
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
	const today = reviewTotalsSince(db, folder.id, todayStart(db, context));
	const month = reviewTotalsSince(db, folder.id, since30);
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
		retention: share(month.retentionRemembered, month.retentionReviews)
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

// The full statistics of one folder.
export function folderStats(db: Db, folder: FolderRow, context: StatsContext): FolderStatsDto {
	const config = dayConfig(db, context);
	const at = (daysBack: number) =>
		new Date(context.now.getTime() - daysBack * DAY_MS).toISOString();
	const today = reviewTotalsSince(db, folder.id, todayStart(db, context));
	const week = reviewTotalsSince(db, folder.id, at(7));
	const month = reviewTotalsSince(db, folder.id, at(30));
	const points = listReviewPointsSince(db, folder.id, at(STREAK_LOOKBACK_DAYS));

	return {
		folder: folderSummary(db, folder, context),
		items: countFolderItems(db, folder.id),
		openLeeches: countLeeches(db, { folderId: folder.id }),
		reviewsToday: today.reviews,
		reviews7Days: week.reviews,
		reviews30Days: month.reviews,
		timeTodayMs: today.timeMs,
		time7DaysMs: week.timeMs,
		retention7Days: share(week.retentionRemembered, week.retentionReviews),
		retention30Days: share(month.retentionRemembered, month.retentionReviews),
		streakDays: streakLength(points, context.now, config, STREAK_LOOKBACK_DAYS),
		days: dailyTotals(points, context.now, config, CHART_DAYS),
		weakTags: weakTags(db, { now: context.now, folderId: folder.id, limit: 5 })
	};
}
