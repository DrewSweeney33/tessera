import type { StatsDto, StatsNumbers, StatsScopeDto } from '#lib/core/api-types.ts';
import {
	dailyTotals,
	streakLength,
	type DayConfig,
	type ReviewPoint
} from '#lib/core/folder-stats.ts';
import { forecast, heatmapWeeks } from '#lib/core/stats.ts';
import { studyDayStart } from '#lib/core/study-day.ts';
import type { Db } from '../db/client.ts';
import { countLeeches, weakTags } from '../leeches/index.ts';
import {
	countScopeCards,
	countScopeItems,
	getSettings,
	listDueUntil,
	listReviewPointsSince,
	practiceTotalsSince,
	reviewTotalsSince,
	type QueueScope
} from '../repos/index.ts';

// The numbers behind the folder panel and the Statistics page (ADR-017). One scope at a time: every deck, one deck,
// or the decks in one folder. Everything is read from the same tables as the rest of the app, limited to decks that
// are not in the Trash, and counts only study (`mode = 'review'`). Practice is reported apart.

const DAY_MS = 86_400_000;
const STREAK_LOOKBACK_DAYS = 400;
const CHART_DAYS = 14;
const HEATMAP_WEEKS = 26;
const FORECAST_DAYS = 30;
const TAG_WINDOW_DAYS = 90;
const TAG_MIN_REVIEWS = 5;
const TAG_LIMIT = 10;

export interface StatsContext {
	now: Date;
	timeZone: string;
}

// The scope with only the fields that are set, for functions that take `{ deckId?: string; folderId?: number }`.
function only(scope: QueueScope): { deckId?: string; folderId?: number } {
	return {
		...(scope.deckId === undefined ? {} : { deckId: scope.deckId }),
		...(scope.folderId === undefined ? {} : { folderId: scope.folderId })
	};
}

function share(remembered: number, total: number): number | null {
	return total === 0 ? null : remembered / total;
}

function dayConfig(db: Db, context: StatsContext): DayConfig {
	return { timeZone: context.timeZone, rolloverHour: getSettings(db).rolloverHour };
}

// The numbers a folder's panel shows, for any scope. `points` are the scope's reviews of the last 400 days, which the
// page also needs for the heatmap, so the caller can pass them in.
export function statsNumbers(
	db: Db,
	scope: QueueScope,
	context: StatsContext,
	points: ReviewPoint[] = listReviewPointsSince(
		db,
		scope,
		new Date(context.now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS).toISOString()
	)
): StatsNumbers {
	const config = dayConfig(db, context);
	const at = (daysBack: number) =>
		new Date(context.now.getTime() - daysBack * DAY_MS).toISOString();
	const today = reviewTotalsSince(
		db,
		scope,
		studyDayStart(context.now, config.timeZone, config.rolloverHour).toISOString()
	);
	const week = reviewTotalsSince(db, scope, at(7));
	const month = reviewTotalsSince(db, scope, at(30));
	return {
		items: countScopeItems(db, scope),
		openLeeches: countLeeches(db, only(scope)),
		reviewsToday: today.reviews,
		reviews7Days: week.reviews,
		reviews30Days: month.reviews,
		timeTodayMs: today.timeMs,
		time7DaysMs: week.timeMs,
		retention7Days: share(week.retentionRemembered, week.retentionReviews),
		retention30Days: share(month.retentionRemembered, month.retentionReviews),
		streakDays: streakLength(points, context.now, config, STREAK_LOOKBACK_DAYS),
		days: dailyTotals(points, context.now, config, CHART_DAYS),
		weakTags: weakTags(db, { now: context.now, limit: 5, ...only(scope) })
	};
}

// Everything the Statistics page shows for a scope.
export function scopeStats(
	db: Db,
	scope: QueueScope,
	label: StatsScopeDto,
	context: StatsContext
): StatsDto {
	const config = dayConfig(db, context);
	const points = listReviewPointsSince(
		db,
		scope,
		new Date(context.now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS).toISOString()
	);
	const dayStart = studyDayStart(context.now, config.timeZone, config.rolloverHour);
	const horizon = new Date(dayStart.getTime() + (FORECAST_DAYS + 1) * DAY_MS).toISOString();
	const counts = countScopeCards(db, scope);
	return {
		...statsNumbers(db, scope, context, points),
		scope: label,
		deckCount: counts.decks,
		cardCount: counts.cards,
		heatmap: heatmapWeeks(points, context.now, config, HEATMAP_WEEKS),
		forecast: forecast(listDueUntil(db, scope, horizon), context.now, config, FORECAST_DAYS),
		tagRetention: weakTags(db, {
			now: context.now,
			windowDays: TAG_WINDOW_DAYS,
			minReviews: TAG_MIN_REVIEWS,
			limit: TAG_LIMIT,
			...only(scope)
		}),
		practicedToday: practiceTotalsSince(db, scope, dayStart.toISOString())
	};
}
