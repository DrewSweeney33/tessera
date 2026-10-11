// Generates tests/fixtures/scheduler/conformance.json by running review sequences through ts-fsrs
// directly. The scheduler wrapper must reproduce every recorded state exactly (ADR-003).
// Re-run only when deliberately upgrading ts-fsrs, and review the diff:  npm run fixtures:scheduler
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
	createEmptyCard,
	fsrs,
	generatorParameters,
	type Card,
	type Grade,
	type StepUnit
} from 'ts-fsrs';

type Offset = 'due' | { minutes: number };
interface Step {
	grade: 1 | 2 | 3 | 4;
	at: Offset;
}
interface Scenario {
	name: string;
	description: string;
	config: {
		targetRetention: number;
		learningSteps: string[];
		relearningSteps: string[];
		maximumIntervalDays: number;
	};
	steps: Step[];
}

const START = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60;
const defaults = {
	targetRetention: 0.9,
	learningSteps: ['1m', '10m'],
	relearningSteps: ['10m'],
	maximumIntervalDays: 36500
};

const due = (grade: 1 | 2 | 3 | 4, count = 1): Step[] =>
	Array.from({ length: count }, () => ({ grade, at: 'due' as const }));

const scenarios: Scenario[] = [
	{
		name: 'new-card-all-good',
		description: 'A new card answered Good every time, reviewed exactly when due.',
		config: defaults,
		steps: due(3, 7)
	},
	{
		name: 'new-card-easy',
		description: 'Easy on a new card skips the learning steps.',
		config: defaults,
		steps: [...due(4), ...due(3, 3)]
	},
	{
		name: 'new-card-again-then-good',
		description: 'Repeated Again keeps a new card in learning.',
		config: defaults,
		steps: [...due(1, 2), ...due(3, 5)]
	},
	{
		name: 'hard-path',
		description: 'Hard answers stretch the learning steps and lower the growth of intervals.',
		config: defaults,
		steps: [...due(2, 4), ...due(3, 3)]
	},
	{
		name: 'lapse-and-recover',
		description: 'A mature card is forgotten, relearned, and graduates again.',
		config: defaults,
		steps: [...due(3, 5), ...due(1), ...due(3, 3)]
	},
	{
		name: 'late-reviews',
		description: 'Reviews that happen long after the due date.',
		config: defaults,
		steps: [
			...due(3, 3),
			{ grade: 3, at: { minutes: 10 * DAY } },
			{ grade: 3, at: { minutes: 30 * DAY } },
			{ grade: 2, at: { minutes: 5 * DAY } }
		]
	},
	{
		name: 'early-review',
		description: 'Reviews that happen before the due date.',
		config: defaults,
		steps: [
			...due(3, 4),
			{ grade: 3, at: { minutes: -2 * DAY } },
			{ grade: 3, at: { minutes: -1 * DAY } }
		]
	},
	{
		name: 'retention-95',
		description: 'A higher target retention gives shorter intervals.',
		config: { ...defaults, targetRetention: 0.95 },
		steps: due(3, 7)
	},
	{
		name: 'retention-80',
		description: 'A lower target retention gives longer intervals.',
		config: { ...defaults, targetRetention: 0.8 },
		steps: due(3, 7)
	},
	{
		name: 'custom-steps',
		description: 'Custom learning and relearning steps including hours and a day.',
		config: { ...defaults, learningSteps: ['5m', '30m', '1d'], relearningSteps: ['15m', '1h'] },
		steps: [...due(3, 5), ...due(1), ...due(3, 4)]
	},
	{
		name: 'mixed-grades',
		description: 'A realistic mix of all four grades.',
		config: defaults,
		steps: [3, 2, 3, 4, 1, 3, 3, 4, 2, 3].map((grade) => ({
			grade: grade as 1 | 2 | 3 | 4,
			at: 'due' as const
		}))
	},
	{
		name: 'maximum-interval-cap',
		description: 'Intervals never exceed the configured maximum.',
		config: { ...defaults, maximumIntervalDays: 90 },
		steps: due(4, 12)
	}
];

const iso = (d: Date | undefined | null) => (d ? d.toISOString() : null);

function snapshot(card: Card) {
	return {
		due: iso(card.due),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		learningSteps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		phase: card.state as number,
		lastReview: iso(card.last_review)
	};
}

const output = scenarios.map((scenario) => {
	const engine = fsrs(
		generatorParameters({
			request_retention: scenario.config.targetRetention,
			maximum_interval: scenario.config.maximumIntervalDays,
			enable_fuzz: false,
			enable_short_term: true,
			learning_steps: scenario.config.learningSteps as StepUnit[],
			relearning_steps: scenario.config.relearningSteps as StepUnit[]
		})
	);
	let card = createEmptyCard(new Date(START));
	let reviewAt = new Date(START);
	const steps = scenario.steps.map((step, index) => {
		if (index > 0) {
			const offset = step.at === 'due' ? 0 : step.at.minutes;
			reviewAt = new Date(card.due.getTime() + offset * 60_000);
		}
		const retrievabilityBefore = engine.get_retrievability(card, reviewAt, false);
		card = engine.next(card, reviewAt, step.grade as Grade).card;
		return {
			reviewAt: reviewAt.toISOString(),
			grade: step.grade,
			retrievabilityBefore,
			after: snapshot(card)
		};
	});
	return {
		name: scenario.name,
		description: scenario.description,
		config: scenario.config,
		start: START,
		steps
	};
});

const version = (
	JSON.parse(readFileSync('node_modules/ts-fsrs/package.json', 'utf8')) as { version: string }
).version;
mkdirSync('tests/fixtures/scheduler', { recursive: true });
writeFileSync(
	'tests/fixtures/scheduler/conformance.json',
	JSON.stringify({ generatedWith: `ts-fsrs@${version}`, scenarios: output }, null, 2) + '\n'
);
console.log(
	`wrote ${output.length} scenarios (${output.reduce((n, s) => n + s.steps.length, 0)} steps) using ts-fsrs@${version}`
);
