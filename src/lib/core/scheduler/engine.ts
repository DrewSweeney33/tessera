import { fsrs, generatorParameters, type FSRS, type StepUnit } from 'ts-fsrs';
import type { SchedulerConfig } from './types.ts';

const STEP = /^[1-9]\d*[mhd]$/;

function steps(name: string, values: readonly string[]): StepUnit[] {
	for (const value of values) {
		if (!STEP.test(value)) {
			throw new Error(
				`Invalid ${name} step "${value}". Use a number and a unit, such as 1m, 10m, 2h, or 1d.`
			);
		}
	}
	return [...values] as StepUnit[];
}

// Builds the FSRS engine from our config. Short-term learning steps are always on, so new and
// lapsed cards repeat within the same session.
export function createEngine(config: SchedulerConfig): FSRS {
	if (!(config.targetRetention > 0 && config.targetRetention < 1)) {
		throw new Error(`targetRetention must be between 0 and 1, got ${config.targetRetention}.`);
	}
	return fsrs(
		generatorParameters({
			request_retention: config.targetRetention,
			maximum_interval: config.maximumIntervalDays,
			enable_fuzz: config.enableFuzz,
			enable_short_term: true,
			learning_steps: steps('learning', config.learningSteps),
			relearning_steps: steps('relearning', config.relearningSteps)
		})
	);
}
