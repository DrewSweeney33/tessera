import { z } from 'zod';

// Request bodies for practice (ADR-017). Strict, like every external input (ADR-005).
export const PracticeStartSchema = z
	.strictObject({
		deckId: z.string().max(64).optional(),
		folderId: z.number().int().positive().max(999_999_999).optional(),
		count: z.union([z.literal('all'), z.number().int().min(1).max(100_000)]),
		order: z.enum(['shuffle', 'weakest'])
	})
	.refine((body) => (body.deckId === undefined) !== (body.folderId === undefined), {
		message: 'Name exactly one of deckId and folderId.'
	});

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
