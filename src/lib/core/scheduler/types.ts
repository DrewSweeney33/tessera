// Our own scheduler types (ADR-003). Nothing outside core/scheduler sees ts-fsrs types.

// Again, Hard, Good, Easy.
export type Grade = 1 | 2 | 3 | 4;
export const GRADES: readonly Grade[] = [1, 2, 3, 4];

// 0 New, 1 Learning, 2 Review, 3 Relearning. Matches the card_state.phase column.
export type CardPhase = 0 | 1 | 2 | 3;
export const PHASE_NAMES = ['New', 'Learning', 'Review', 'Relearning'] as const;

// The schedule of one review item. Mirrors a card_state row.
export interface ItemState {
	due: Date;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	// How many learning steps have been completed.
	learningSteps: number;
	reps: number;
	lapses: number;
	phase: CardPhase;
	lastReview: Date | null;
}

export interface SchedulerConfig {
	// Probability of recalling a card when it comes due. 0.90 is the default.
	targetRetention: number;
	// Short-term steps for new cards and relearning, such as "1m", "10m", "1d".
	learningSteps: readonly string[];
	relearningSteps: readonly string[];
	maximumIntervalDays: number;
	// Spreads similar due dates apart. Off in conformance tests.
	enableFuzz: boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = Object.freeze({
	targetRetention: 0.9,
	learningSteps: Object.freeze(['1m', '10m']),
	relearningSteps: Object.freeze(['10m']),
	maximumIntervalDays: 36_500,
	enableFuzz: true
});

export interface GradePreview {
	// The state this grade would produce right now.
	next: ItemState;
	// Short label for the button, such as "10m", "4d", or "1.2mo".
	label: string;
}

// Read-only half: safe for cram mode, which must never change a schedule.
export interface SchedulerReader {
	// Probability of recall at `now`, from 0 to 1. A New item has none yet (0).
	retrievability(state: ItemState, now: Date): number;
}

export interface Scheduler extends SchedulerReader {
	initialState(now: Date): ItemState;
	preview(state: ItemState, now: Date): Record<Grade, GradePreview>;
	review(state: ItemState, grade: Grade, now: Date): ItemState;
}
