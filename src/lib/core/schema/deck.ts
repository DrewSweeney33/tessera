import { z } from 'zod';
import { err, ok, type Result } from '../result.ts';
import { CardSchema } from './card.ts';
import { toImportErrors, type ImportError } from './errors.ts';
import { ID_MESSAGE, ID_PATTERN, LIMITS, TAG_MESSAGE, TAG_PATTERN } from './limits.ts';

export const FORMAT_VERSION = 1;

export const DeckMetaSchema = z.strictObject({
	id: z
		.string()
		.regex(ID_PATTERN, { message: `deck id ${ID_MESSAGE}` })
		.describe(
			'Stable deck id. Importing the same id again updates the deck instead of creating a new one.'
		),
	title: z
		.string()
		.max(LIMITS.maxTitleLength, {
			message: `title is too long (maximum ${LIMITS.maxTitleLength} characters)`
		})
		.regex(/\S/, { message: 'title must not be blank' })
		.describe('Deck title shown in the app.'),
	description: z
		.string()
		.max(LIMITS.maxDescriptionLength, {
			message: `description is too long (maximum ${LIMITS.maxDescriptionLength} characters)`
		})
		.optional()
		.describe('Optional short description.'),
	tags: z
		.array(
			z
				.string()
				.max(LIMITS.maxTagLength, {
					message: `a tag is too long (maximum ${LIMITS.maxTagLength} characters)`
				})
				.regex(TAG_PATTERN, { message: `a tag ${TAG_MESSAGE}` })
		)
		.max(LIMITS.maxTags, { message: `too many tags (maximum ${LIMITS.maxTags})` })
		.optional()
		.describe('Optional deck-level tags.')
});

export const DeckFileSchema = z
	.strictObject({
		tessera: z.literal(FORMAT_VERSION).describe('Format version. Must be 1.'),
		deck: DeckMetaSchema,
		cards: z
			.array(CardSchema)
			.min(1, { message: 'cards needs at least 1 item' })
			.max(LIMITS.maxCards, { message: `cards allows at most ${LIMITS.maxCards} items` })
			.describe('The cards in the deck.')
	})
	.superRefine((file, ctx) => {
		const firstUse = new Map<string, number>();
		file.cards.forEach((card, index) => {
			if (card.id === undefined) return;
			const first = firstUse.get(card.id);
			if (first === undefined) {
				firstUse.set(card.id, index);
			} else {
				ctx.addIssue({
					code: 'custom',
					message: `card id "${card.id}" is already used by cards[${first}]`,
					path: ['cards', index, 'id'],
					params: { errorCode: 'duplicate_id' }
				});
			}
		});
	});

export type Deck = z.infer<typeof DeckFileSchema>;
export type DeckMeta = z.infer<typeof DeckMetaSchema>;

// The one validator for both formats (ADR-002). Returns the validated deck or path-level errors.
export function validateDeck(input: unknown): Result<Deck, ImportError[]> {
	const parsed = DeckFileSchema.safeParse(input);
	if (parsed.success) return ok(parsed.data);
	return err(toImportErrors(parsed.error.issues, input));
}
