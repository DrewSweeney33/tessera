import { createEngine } from './engine.ts';
import { toCard } from './map.ts';
import {
	DEFAULT_SCHEDULER_CONFIG,
	type ItemState,
	type SchedulerConfig,
	type SchedulerReader
} from './types.ts';

// The read-only half of the scheduler. It cannot change a schedule, so cram mode may use it.
export function createReader(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): SchedulerReader {
	const engine = createEngine(config);
	return {
		retrievability: (state: ItemState, now: Date) =>
			engine.get_retrievability(toCard(state), now, false)
	};
}
