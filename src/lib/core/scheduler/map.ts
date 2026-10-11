import type { Card } from 'ts-fsrs';
import type { CardPhase, ItemState } from './types.ts';

// The only place ts-fsrs cards and our states are converted. Dates are copied so neither side
// can mutate the other.
export function toCard(state: ItemState): Card {
	return {
		due: new Date(state.due),
		stability: state.stability,
		difficulty: state.difficulty,
		elapsed_days: state.elapsedDays,
		scheduled_days: state.scheduledDays,
		learning_steps: state.learningSteps,
		reps: state.reps,
		lapses: state.lapses,
		state: state.phase,
		...(state.lastReview ? { last_review: new Date(state.lastReview) } : {})
	};
}

export function fromCard(card: Card): ItemState {
	return {
		due: new Date(card.due),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		learningSteps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		phase: card.state as CardPhase,
		lastReview: card.last_review ? new Date(card.last_review) : null
	};
}
