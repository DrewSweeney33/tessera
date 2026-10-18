import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

// Checking the password (ADR-021). The configured password is hashed once at startup with scrypt and a random salt that
// lives only in memory. A guess is hashed the same way and the two are compared in constant time, so how long a check
// takes says nothing about how close the guess was. scrypt also makes each guess cost real time.

const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
	});
}

export interface PasswordChecker {
	verify(candidate: string): Promise<boolean>;
}

export function createPasswordChecker(password: string): PasswordChecker {
	const salt = randomBytes(16);
	const expected = scryptSync(password, salt, KEY_LENGTH);
	return {
		async verify(candidate: string): Promise<boolean> {
			const given = await scryptAsync(candidate, salt);
			return timingSafeEqual(given, expected);
		}
	};
}
