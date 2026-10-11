import { z } from 'zod';
import {
	CLOZE_MARKER_PATTERN,
	ID_MESSAGE,
	ID_PATTERN,
	LIMITS,
	TAG_MESSAGE,
	TAG_PATTERN
} from './limits.ts';

// Text fields are Markdown. Blank strings are rejected so empty cards cannot slip in.
const text = (field: string, description: string) =>
	z
		.string()
		.max(LIMITS.maxTextLength, {
			message: `${field} is too long (maximum ${LIMITS.maxTextLength} characters)`
		})
		.regex(/\S/, { message: `${field} must not be blank` })
		.describe(description);

const id = z
	.string()
	.regex(ID_PATTERN, { message: `id ${ID_MESSAGE}` })
	.describe(
		'Stable card id, unique within the deck. Keep it unchanged when you revise a card so review history is preserved.'
	);

const tags = z
	.array(
		z
			.string()
			.max(LIMITS.maxTagLength, {
				message: `a tag is too long (maximum ${LIMITS.maxTagLength} characters)`
			})
			.regex(TAG_PATTERN, { message: `a tag ${TAG_MESSAGE}` })
	)
	.max(LIMITS.maxTags, { message: `too many tags (maximum ${LIMITS.maxTags})` })
	.describe('Optional tags used for filtering, cram mode, and weak-spot reports.');

const source = z
	.string()
	.min(1, { message: 'source must not be empty' })
	.max(LIMITS.maxSourceLength, {
		message: `source is too long (maximum ${LIMITS.maxSourceLength} characters)`
	})
	.describe('Optional note on where the card came from, for example "Lesson 3".');

const hint = text('hint', 'Optional hint shown on request before the answer.');

const common = {
	id: id.optional(),
	hint: hint.optional(),
	tags: tags.optional(),
	source: source.optional()
};

export const BasicCardSchema = z.strictObject({
	type: z.literal('basic'),
	front: text('front', 'The question or prompt (Markdown).'),
	back: text('back', 'The answer (Markdown).'),
	...common
});

export const ClozeCardSchema = z.strictObject({
	type: z.literal('cloze'),
	text: text(
		'text',
		'Text with one or more {{c1::answer}} markers. Each marker number is reviewed separately.'
	).regex(CLOZE_MARKER_PATTERN, {
		message: 'text needs at least one cloze marker such as {{c1::answer}}'
	}),
	extra: text('extra', 'Optional extra information shown after the answer.').optional(),
	...common
});

export const TypedCardSchema = z.strictObject({
	type: z.literal('typed'),
	front: text('front', 'The question or prompt (Markdown).'),
	answer: text('answer', 'The exact answer the learner types.'),
	accept: z
		.array(
			z
				.string()
				.min(1, { message: 'an accepted answer must not be empty' })
				.max(LIMITS.maxAcceptLength, {
					message: `an accepted answer is too long (maximum ${LIMITS.maxAcceptLength} characters)`
				})
		)
		.max(LIMITS.maxAccept, { message: `too many accepted answers (maximum ${LIMITS.maxAccept})` })
		.optional()
		.describe('Optional alternate answers that also count as correct, for example abbreviations.'),
	...common
});

export const ChoiceCardSchema = z
	.strictObject({
		type: z.literal('choice'),
		front: text('front', 'The question (Markdown).'),
		choices: z
			.array(
				z
					.string()
					.min(1, { message: 'a choice must not be empty' })
					.max(LIMITS.maxChoiceLength, {
						message: `a choice is too long (maximum ${LIMITS.maxChoiceLength} characters)`
					})
			)
			.min(LIMITS.minChoices, { message: `choices needs at least ${LIMITS.minChoices} items` })
			.max(LIMITS.maxChoices, { message: `choices allows at most ${LIMITS.maxChoices} items` })
			.describe('The options shown to the learner, 2 to 8.'),
		correct: z
			.number()
			.int({ message: 'correct must be a whole number' })
			.min(0, { message: 'correct must be zero or greater' })
			.describe('Zero-based index into choices of the single correct option.'),
		explanation: text('explanation', 'Optional explanation shown after answering.').optional(),
		...common
	})
	.superRefine((card, ctx) => {
		if (card.correct >= card.choices.length) {
			ctx.addIssue({
				code: 'custom',
				message: `correct is ${card.correct} but there are only ${card.choices.length} choices (valid indexes are 0 to ${card.choices.length - 1})`,
				path: ['correct'],
				params: { errorCode: 'out_of_range' }
			});
		}
		const seen = new Map<string, number>();
		card.choices.forEach((choice, index) => {
			const key = choice.trim().toLowerCase();
			const first = seen.get(key);
			if (first === undefined) {
				seen.set(key, index);
			} else {
				ctx.addIssue({
					code: 'custom',
					message: `choice ${index} repeats choice ${first}`,
					path: ['choices', index],
					params: { errorCode: 'duplicate_choice' }
				});
			}
		});
	});

export const CardSchema = z.discriminatedUnion('type', [
	BasicCardSchema,
	ClozeCardSchema,
	TypedCardSchema,
	ChoiceCardSchema
]);

export type BasicCard = z.infer<typeof BasicCardSchema>;
export type ClozeCard = z.infer<typeof ClozeCardSchema>;
export type TypedCard = z.infer<typeof TypedCardSchema>;
export type ChoiceCard = z.infer<typeof ChoiceCardSchema>;
export type Card = z.infer<typeof CardSchema>;
export type CardType = Card['type'];

export const CARD_TYPES: readonly CardType[] = ['basic', 'cloze', 'typed', 'choice'];

// Field names per card type, used to make "unknown field" errors list what is allowed.
export const CARD_FIELDS: Record<CardType, readonly string[]> = {
	basic: Object.keys(BasicCardSchema.shape),
	cloze: Object.keys(ClozeCardSchema.shape),
	typed: Object.keys(TypedCardSchema.shape),
	choice: Object.keys(ChoiceCardSchema.shape)
};
