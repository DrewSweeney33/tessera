import type { Clock } from '#lib/server/clock.ts';

export interface FakeClock extends Clock {
	set(date: Date | string): void;
	advance(ms: number): void;
}

export function fakeClock(start: Date | string = '2026-10-10T12:00:00.000Z'): FakeClock {
	let current = new Date(start);
	return {
		now: () => new Date(current),
		set: (date) => {
			current = new Date(date);
		},
		advance: (ms) => {
			current = new Date(current.getTime() + ms);
		}
	};
}
