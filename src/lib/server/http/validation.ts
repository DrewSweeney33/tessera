import type { z } from 'zod';
import { formatPath } from '#lib/core/schema/errors.ts';

export interface FieldError {
	path: string;
	code: string;
	message: string;
}

// Turns Zod issues for a small request body into the same {path, code, message} shape the import
// errors use, so every API reports problems one way.
export function fieldErrors(error: z.ZodError): FieldError[] {
	return error.issues.map((issue) => {
		if (issue.code === 'unrecognized_keys') {
			return {
				path: formatPath([...issue.path, ...issue.keys.slice(0, 1)]),
				code: 'unknown_field',
				message: `unknown field ${issue.keys.map((k) => `"${k}"`).join(', ')}`
			};
		}
		return {
			path: formatPath(issue.path),
			code: issue.code === 'invalid_type' ? 'wrong_type' : 'invalid',
			message: issue.message
		};
	});
}
