import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	createScheduler,
	type ItemState,
	type SchedulerConfig
} from '#lib/core/scheduler/index.ts';

// The fixtures were produced by running ts-fsrs directly (scripts/gen-scheduler-fixtures.ts).
// The wrapper must reproduce every state exactly. If a ts-fsrs upgrade changes behavior, this fails.
interface StateJson {
	due: string;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	learningSteps: number;
	reps: number;
	lapses: number;
	phase: 0 | 1 | 2 | 3;
	lastReview: string | null;
}
interface Fixture {
	generatedWith: string;
	scenarios: {
		name: string;
		description: string;
		config: Omit<SchedulerConfig, 'enableFuzz'>;
		start: string;
		steps: {
			reviewAt: string;
			grade: 1 | 2 | 3 | 4;
			retrievabilityBefore: number;
			after: StateJson;
		}[];
	}[];
}

const fixture = JSON.parse(
	readFileSync('tests/fixtures/scheduler/conformance.json', 'utf8')
) as Fixture;

function expectState(actual: ItemState, expected: StateJson, where: string) {
	expect(actual.due.toISOString(), `${where} due`).toBe(expected.due);
	expect(actual.stability, `${where} stability`).toBeCloseTo(expected.stability, 9);
	expect(actual.difficulty, `${where} difficulty`).toBeCloseTo(expected.difficulty, 9);
	expect(actual.elapsedDays, `${where} elapsedDays`).toBe(expected.elapsedDays);
	expect(actual.scheduledDays, `${where} scheduledDays`).toBe(expected.scheduledDays);
	expect(actual.learningSteps, `${where} learningSteps`).toBe(expected.learningSteps);
	expect(actual.reps, `${where} reps`).toBe(expected.reps);
	expect(actual.lapses, `${where} lapses`).toBe(expected.lapses);
	expect(actual.phase, `${where} phase`).toBe(expected.phase);
	expect(actual.lastReview?.toISOString() ?? null, `${where} lastReview`).toBe(expected.lastReview);
}

describe('scheduler conformance with ts-fsrs', () => {
	it('uses the pinned reference library', () => {
		expect(fixture.generatedWith).toBe('ts-fsrs@5.4.2');
		expect(fixture.scenarios.length).toBeGreaterThanOrEqual(12);
	});

	for (const scenario of fixture.scenarios) {
		it(`${scenario.name}: ${scenario.description}`, () => {
			const scheduler = createScheduler({ ...scenario.config, enableFuzz: false });
			let state = scheduler.initialState(new Date(scenario.start));

			scenario.steps.forEach((step, index) => {
				const where = `${scenario.name} step ${index + 1} (grade ${step.grade})`;
				const reviewAt = new Date(step.reviewAt);

				expect(scheduler.retrievability(state, reviewAt), `${where} retrievability`).toBeCloseTo(
					step.retrievabilityBefore,
					9
				);

				const next = scheduler.review(state, step.grade, reviewAt);
				expectState(next, step.after, where);

				// The grade button preview must show exactly what pressing it will do.
				expectState(
					scheduler.preview(state, reviewAt)[step.grade].next,
					step.after,
					`${where} preview`
				);

				state = next;
			});
		});
	}
});
