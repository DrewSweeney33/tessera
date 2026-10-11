import { createEmptyCard, type Grade as TsGrade } from 'ts-fsrs';
import { createEngine } from './engine.ts';
import { formatInterval } from './labels.ts';
import { fromCard, toCard } from './map.ts';
import {
	DEFAULT_SCHEDULER_CONFIG,
	GRADES,
	type Grade,
	type GradePreview,
	type Scheduler,
	type SchedulerConfig
} from './types.ts';

// The full scheduler. Everything is pure: time is passed in, inputs are never mutated.
export function createScheduler(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): Scheduler {
	const engine = createEngine(config);

	return {
		initialState: (now) => fromCard(createEmptyCard(new Date(now))),

		preview(state, now) {
			const results = engine.repeat(toCard(state), new Date(now));
			const out = {} as Record<Grade, GradePreview>;
			for (const grade of GRADES) {
				const next = fromCard(results[grade as TsGrade].card);
				out[grade] = { next, label: formatInterval(now, next.due) };
			}
			return out;
		},

		review: (state, grade, now) =>
			fromCard(engine.next(toCard(state), new Date(now), grade as TsGrade).card),

		retrievability: (state, now) => engine.get_retrievability(toCard(state), now, false)
	};
}
