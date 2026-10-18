// Slowing wrong guesses down without ever locking anyone out (ADR-021). Behind a reverse proxy every caller has the
// proxy address, so there is nobody to count separately: the count is for everyone. The third wrong guess in 15
// minutes waits half a second before it is answered, then 1 s, 2, 4, up to 30 s. The right password waits the same
// time, so a stranger can neither lock the owner out nor get answers faster by guessing in parallel: attempts that are
// already waiting count too, and at most 20 wait at once.

export const FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_WAITING = 20;
export const MAX_DELAY_MS = 30_000;

// How long an attempt waits when `pending` guesses (failed ones in the window plus ones already waiting) came before.
export function failureDelayMs(pending: number): number {
	if (pending < 3) return 0;
	return Math.min(MAX_DELAY_MS, 500 * 2 ** (pending - 3));
}

export class LoginThrottle {
	private failures: number[] = [];
	private waiting = 0;
	private readonly now: () => number;

	constructor(now: () => number) {
		this.now = now;
	}

	private prune(): void {
		const cutoff = this.now() - FAILURE_WINDOW_MS;
		this.failures = this.failures.filter((at) => at > cutoff);
	}

	// Wrong guesses in the window.
	recentFailures(): number {
		this.prune();
		return this.failures.length;
	}

	// Takes a place in line. Undefined when 20 attempts are already waiting.
	enter(): { delayMs: number } | undefined {
		if (this.waiting >= MAX_WAITING) return undefined;
		const delayMs = failureDelayMs(this.recentFailures() + this.waiting);
		this.waiting += 1;
		return { delayMs };
	}

	leave(): void {
		this.waiting = Math.max(0, this.waiting - 1);
	}

	recordFailure(): void {
		this.failures.push(this.now());
	}

	recordSuccess(): void {
		this.failures = [];
	}
}
