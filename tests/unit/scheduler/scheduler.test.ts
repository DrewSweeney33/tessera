import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_SCHEDULER_CONFIG,
	GRADES,
	PHASE_NAMES,
	createReader,
	createScheduler,
	formatInterval,
	type ItemState
} from '#lib/core/scheduler/index.ts';

const T0 = new Date('2026-10-10T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const exact = createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, enableFuzz: false });

// A card that has graduated: three Good answers, each at its due time.
function graduated(): { state: ItemState; now: Date } {
	let state = exact.initialState(T0);
	let now = T0;
	for (let i = 0; i < 4; i++) {
		state = exact.review(state, 3, now);
		now = state.due;
	}
	return { state, now };
}

describe('initialState', () => {
	it('is a New card due now with no history', () => {
		expect(exact.initialState(T0)).toEqual({
			due: T0,
			stability: 0,
			difficulty: 0,
			elapsedDays: 0,
			scheduledDays: 0,
			learningSteps: 0,
			reps: 0,
			lapses: 0,
			phase: 0,
			lastReview: null
		});
	});

	it('does not share the caller date', () => {
		const now = new Date(T0);
		const state = exact.initialState(now);
		now.setFullYear(2000);
		expect(state.due.getFullYear()).toBe(2026);
	});
});

describe('review and preview', () => {
	it('moves a New card into Learning with a short step on Good', () => {
		const next = exact.review(exact.initialState(T0), 3, T0);
		expect(next.phase).toBe(1);
		expect(next.reps).toBe(1);
		expect(next.due.getTime() - T0.getTime()).toBe(10 * MIN);
		expect(next.lastReview).toEqual(T0);
	});

	it('graduates a learning card to Review after the learning steps', () => {
		const { state } = graduated();
		expect(state.phase).toBe(2);
		expect(state.scheduledDays).toBeGreaterThan(0);
		expect(state.stability).toBeGreaterThan(0);
	});

	it('sends a forgotten Review card to Relearning and counts the lapse', () => {
		const { state, now } = graduated();
		const lapsed = exact.review(state, 1, now);
		expect(lapsed.phase).toBe(3);
		expect(lapsed.lapses).toBe(state.lapses + 1);
		expect(lapsed.due.getTime() - now.getTime()).toBe(10 * MIN);
	});

	it('never mutates the input state', () => {
		const { state, now } = graduated();
		const before = JSON.stringify(state);
		exact.review(state, 3, now);
		exact.preview(state, now);
		exact.retrievability(state, now);
		expect(JSON.stringify(state)).toBe(before);
	});

	it('previews all four grades with labels matching the interval', () => {
		const { state, now } = graduated();
		const preview = exact.preview(state, now);
		for (const grade of GRADES) {
			expect(preview[grade].label).toBe(formatInterval(now, preview[grade].next.due));
		}
		expect(preview[1].label).toBe('10m');
	});

	it('orders intervals Again < Hard <= Good <= Easy for a Review card', () => {
		const { state, now } = graduated();
		const p = exact.preview(state, now);
		const interval = (g: 1 | 2 | 3 | 4) => p[g].next.due.getTime() - now.getTime();
		expect(interval(1)).toBeLessThan(interval(2));
		expect(interval(2)).toBeLessThanOrEqual(interval(3));
		expect(interval(3)).toBeLessThanOrEqual(interval(4));
	});

	it('makes Easy on a New card skip learning', () => {
		const next = exact.review(exact.initialState(T0), 4, T0);
		expect(next.phase).toBe(2);
		expect(next.due.getTime() - T0.getTime()).toBeGreaterThanOrEqual(DAY);
	});

	it('shows New card previews on every grade', () => {
		const p = exact.preview(exact.initialState(T0), T0);
		expect(p[1].label).toBe('1m');
		expect(p[3].label).toBe('10m');
		expect(p[4].next.phase).toBe(2);
	});
});

describe('retrievability', () => {
	it('is 0 for a New card, 1 just after review, and falls over time', () => {
		expect(exact.retrievability(exact.initialState(T0), T0)).toBe(0);
		const { state } = graduated();
		const reviewedAt = state.lastReview!;
		expect(exact.retrievability(state, reviewedAt)).toBeCloseTo(1, 9);
		const week = exact.retrievability(state, new Date(reviewedAt.getTime() + 7 * DAY));
		const month = exact.retrievability(state, new Date(reviewedAt.getTime() + 30 * DAY));
		expect(week).toBeLessThan(1);
		expect(month).toBeLessThan(week);
		expect(month).toBeGreaterThan(0);
	});

	it('equals the target retention at the scheduled due time', () => {
		const { state } = graduated();
		expect(exact.retrievability(state, state.due)).toBeCloseTo(0.9, 2);
	});

	it('is available from the read-only reader without any ability to review', () => {
		const { state, now } = graduated();
		const reader = createReader({ ...DEFAULT_SCHEDULER_CONFIG, enableFuzz: false });
		expect(reader.retrievability(state, now)).toBeCloseTo(exact.retrievability(state, now), 12);
		expect(Object.keys(reader)).toEqual(['retrievability']);
	});

	it('keeps the reader module free of any import of review', () => {
		const source = readFileSync('src/lib/core/scheduler/read.ts', 'utf8');
		expect(source).not.toMatch(/from '\.\/review/);
		expect(source).not.toMatch(/createScheduler/);
	});
});

describe('configuration', () => {
	it('uses the documented defaults', () => {
		expect(DEFAULT_SCHEDULER_CONFIG).toMatchObject({
			targetRetention: 0.9,
			learningSteps: ['1m', '10m'],
			relearningSteps: ['10m'],
			maximumIntervalDays: 36500,
			enableFuzz: true
		});
	});

	it('gives longer intervals at lower target retention', () => {
		const build = (targetRetention: number) => {
			const s = createScheduler({
				...DEFAULT_SCHEDULER_CONFIG,
				targetRetention,
				enableFuzz: false
			});
			let state = s.initialState(T0);
			let now = T0;
			for (let i = 0; i < 5; i++) {
				state = s.review(state, 3, now);
				now = state.due;
			}
			return state.scheduledDays;
		};
		expect(build(0.8)).toBeGreaterThan(build(0.9));
		expect(build(0.9)).toBeGreaterThan(build(0.95));
	});

	it('honors custom learning steps', () => {
		const s = createScheduler({
			...DEFAULT_SCHEDULER_CONFIG,
			learningSteps: ['5m', '30m'],
			enableFuzz: false
		});
		const p = s.preview(s.initialState(T0), T0);
		expect(p[1].label).toBe('5m');
	});

	it('rejects invalid steps and retention with a helpful message', () => {
		expect(() => createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, learningSteps: ['10x'] })).toThrow(
			/Invalid learning step "10x"/
		);
		expect(() => createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, relearningSteps: ['0m'] })).toThrow(
			/Invalid relearning step/
		);
		expect(() => createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, targetRetention: 1 })).toThrow(
			/between 0 and 1/
		);
		expect(() => createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, targetRetention: 0 })).toThrow();
	});
});

describe('fuzz', () => {
	const fuzzy = createScheduler({ ...DEFAULT_SCHEDULER_CONFIG, enableFuzz: true });

	function matureState() {
		let state = fuzzy.initialState(T0);
		let now = T0;
		for (let i = 0; i < 6; i++) {
			state = exact.review(state, 3, now);
			now = state.due;
		}
		return { state, now };
	}

	it('stays close to the exact interval', () => {
		const { state, now } = matureState();
		const exactDays = exact.review(state, 3, now).scheduledDays;
		const fuzzDays = fuzzy.review(state, 3, now).scheduledDays;
		expect(Math.abs(fuzzDays - exactDays)).toBeLessThanOrEqual(Math.ceil(exactDays * 0.25));
	});

	it('is repeatable for identical input and time', () => {
		const { state, now } = matureState();
		expect(fuzzy.review(state, 3, now).due.getTime()).toBe(
			fuzzy.review(state, 3, now).due.getTime()
		);
	});
});

describe('formatInterval', () => {
	const at = (ms: number) => formatInterval(T0, new Date(T0.getTime() + ms));

	it.each([
		[0, '<1m'],
		[30_000, '<1m'],
		[MIN, '1m'],
		[10 * MIN, '10m'],
		[59 * MIN, '59m'],
		[HOUR, '1h'],
		[5 * HOUR, '5h'],
		[DAY, '1d'],
		[4 * DAY, '4d'],
		[29 * DAY, '29d'],
		[30 * DAY, '1mo'],
		[45 * DAY, '1.5mo'],
		[200 * DAY, '6.7mo'],
		[365 * DAY, '1y'],
		[900 * DAY, '2.5y']
	])('%d ms is %s', (ms, label) => {
		expect(at(ms)).toBe(label);
	});

	it('never shows a negative interval', () => {
		expect(formatInterval(T0, new Date(T0.getTime() - DAY))).toBe('<1m');
	});
});

describe('phase names', () => {
	it('lists the four phases in order', () => {
		expect([...PHASE_NAMES]).toEqual(['New', 'Learning', 'Review', 'Relearning']);
	});
});
