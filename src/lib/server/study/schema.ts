import { z } from 'zod';

// The body of a review submission. Strict, like every external input (ADR-005).
export const ReviewInputSchema = z.strictObject({
	// Client-generated, so a double click or a retried request cannot grade twice.
	reviewId: z
		.string()
		.min(8)
		.max(64)
		.regex(/^[A-Za-z0-9-]+$/, {
			message: 'reviewId may contain only letters, digits, and hyphens'
		}),
	cardPk: z.number().int().positive(),
	ordinal: z.number().int().min(0).max(99),
	grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
	// When the item was served. If the item was reviewed after this, the submission is stale.
	servedAt: z.iso.datetime({ message: 'servedAt must be an ISO 8601 UTC timestamp' }),
	durationMs: z.number().int().min(0).max(3_600_000).optional(),
	typedAnswer: z.string().max(2000).optional()
});

export type ReviewInput = z.infer<typeof ReviewInputSchema>;

// The body of an undo (ADR-019): the answer to take back, named by the id the browser sent when it answered. The deck
// or folder being studied is optional, so the response can carry the counts of the session.
export const UndoInputSchema = z.strictObject({
	reviewId: ReviewInputSchema.shape.reviewId,
	deckId: z.string().max(64).optional(),
	folderId: z.number().int().positive().max(999_999_999).optional()
});

export type UndoInput = z.infer<typeof UndoInputSchema>;
