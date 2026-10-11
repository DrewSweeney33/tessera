// The only module allowed to read real time (see the lint rule for Date.now and new Date()).
// Everything else receives a Clock or a `now` value so time is testable.
export interface Clock {
	now(): Date;
}

export const systemClock: Clock = {
	now: () => new Date()
};
