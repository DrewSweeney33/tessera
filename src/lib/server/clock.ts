// The only module allowed to read real time or randomness (see the lint rules for Date.now,
// new Date(), and Math.random). Everything else receives a Clock or an rng so it is testable.
export interface Clock {
	now(): Date;
}

export const systemClock: Clock = {
	now: () => new Date()
};

// A function returning a number in [0, 1). Injected wherever order is randomized.
export type Rng = () => number;

export const systemRng: Rng = () => Math.random();
