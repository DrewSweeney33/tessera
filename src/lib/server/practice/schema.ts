import { z } from 'zod';
import { LIMITS, TAG_PATTERN } from '#lib/core/schema/limits.ts';

// Request bodies for practice (ADR-017). Strict, like every external input (ADR-005).
// A tag as a card carries it: no commas or line breaks, no leading or trailing space, at most 40 characters.
export const PracticeTagSchema = z.string().max(LIMITS.maxTagLength).regex(TAG_PATTERN);

export const PracticeStartSchema = z
	.strictObject({
		deckId: z.string().max(64).optional(),
		folderId: z.number().int().positive().max(999_999_999).optional(),
		tag: PracticeTagSchema.optional(),
		quiz: z.boolean().optional(),
		count: z.union([z.literal('all'), z.number().int().min(1).max(100_000)]),
		order: z.enum(['shuffle', 'weakest'])
	})
	.refine(
		(body) =>
			[body.deckId, body.folderId, body.tag].filter((scope) => scope !== undefined).length === 1,
		{ message: 'Name exactly one of deckId, folderId, and tag.' }
	);

export type PracticeStartInput = z.infer<typeof PracticeStartSchema>;

export const PracticeGradeSchema = z.strictObject({
	// Client-generated, so a double click or a retried request cannot add a second row.
	reviewId: z
		.string()
		.min(8)
		.max(64)
		.regex(/^[A-Za-z0-9-]+$/, {
			message: 'reviewId may contain only letters, digits, and hyphens'
		}),
	cardPk: z.number().int().positive(),
	ordinal: z.number().int().min(0).max(99),
	right: z.boolean(),
	durationMs: z.number().int().min(0).max(3_600_000).optional(),
	typedAnswer: z.string().max(2000).optional()
});

export type PracticeGradeInput = z.infer<typeof PracticeGradeSchema>;

// The seed that fixes a quiz session's questions (ADR-020): letters and digits only, sent back with each item request.
export const QuizSeedSchema = z.string().regex(/^[A-Za-z0-9]{8,32}$/);

// Undo of the last practice answer (ADR-019).
export const PracticeUndoSchema = z.strictObject({
	reviewId: PracticeGradeSchema.shape.reviewId
});

export type PracticeUndoInput = z.infer<typeof PracticeUndoSchema>;
