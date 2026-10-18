import type { SerializedState } from '#lib/core/api-types.ts';
import type { CardPhase, ItemState } from '#lib/core/scheduler/types.ts';
import type { CardStatePatch } from '../repos/index.ts';
import type { CardStateRow } from '../db/schema.ts';

// Converts between a card_state row (ISO strings) and the scheduler's ItemState (Dates).
export function toItemState(row: CardStateRow): ItemState {
	return {
		due: new Date(row.due),
		stability: row.stability,
		difficulty: row.difficulty,
		elapsedDays: row.elapsedDays,
		scheduledDays: row.scheduledDays,
		learningSteps: row.learningSteps,
		reps: row.reps,
		lapses: row.lapses,
		phase: row.phase as CardPhase,
		lastReview: row.lastReview ? new Date(row.lastReview) : null
	};
}

export function toStatePatch(state: ItemState): CardStatePatch {
	return {
		due: state.due.toISOString(),
		stability: state.stability,
		difficulty: state.difficulty,
		elapsedDays: state.elapsedDays,
		scheduledDays: state.scheduledDays,
		learningSteps: state.learningSteps,
		reps: state.reps,
		lapses: state.lapses,
		phase: state.phase,
		lastReview: state.lastReview ? state.lastReview.toISOString() : null
	};
}

// The review_log "pre" columns for an item about to be reviewed.
export function toPreColumns(state: ItemState) {
	return {
		preDue: state.due.toISOString(),
		preStability: state.stability,
		preDifficulty: state.difficulty,
		preElapsedDays: state.elapsedDays,
		preScheduledDays: state.scheduledDays,
		preLearningSteps: state.learningSteps,
		preReps: state.reps,
		preLapses: state.lapses,
		prePhase: state.phase,
		preLastReview: state.lastReview ? state.lastReview.toISOString() : null
	};
}

// An ItemState with dates as ISO strings, as stored in review_log.result and sent to the client.
export function serializeState(state: ItemState): SerializedState {
	return {
		due: state.due.toISOString(),
		stability: state.stability,
		difficulty: state.difficulty,
		elapsedDays: state.elapsedDays,
		scheduledDays: state.scheduledDays,
		learningSteps: state.learningSteps,
		reps: state.reps,
		lapses: state.lapses,
		phase: state.phase,
		lastReview: state.lastReview ? state.lastReview.toISOString() : null
	};
}
