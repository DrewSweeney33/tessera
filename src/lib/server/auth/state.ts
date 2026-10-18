import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { createPasswordChecker, type PasswordChecker } from './password.ts';
import { deriveSessionKey } from './session.ts';
import { LoginThrottle } from './throttle.ts';

// Everything sign-in needs, built once at boot and only when a password is set. `app.auth` is undefined when sign-in is
// off, so the off state is one check and cannot leave anything half on.
export interface AuthState {
	// Signs and checks the login cookie. Derived from the password, so a new password makes a new key.
	readonly key: Buffer;
	readonly checker: PasswordChecker;
	readonly throttle: LoginThrottle;
	// Waits. Injected so a test does not wait for real.
	readonly sleep: (ms: number) => Promise<void>;
}

export function realSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAuth(
	config: Config,
	clock: Clock,
	sleep: (ms: number) => Promise<void> = realSleep
): AuthState | undefined {
	if (config.password === undefined) return undefined;
	return {
		key: deriveSessionKey(config.password),
		checker: createPasswordChecker(config.password),
		throttle: new LoginThrottle(() => clock.now().getTime()),
		sleep
	};
}
