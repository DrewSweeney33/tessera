import { err, ok, type Result } from '#lib/core/result.ts';
import { DeckMetaSchema } from '#lib/core/schema/deck.ts';
import { LIMITS } from '#lib/core/schema/limits.ts';
import { slugifyTitle } from '#lib/core/slug.ts';
import type { Db, Executor } from '../db/client.ts';
import { withTx } from '../db/tx.ts';
import type { DeckRow } from '../db/schema.ts';
import { fieldErrors, type FieldError } from '../http/validation.ts';
import { getDeck, upsertDeck } from '../repos/index.ts';

// Making a deck by hand (US-11, ADR-013). A deck file must hold at least one card, so this does not go through
// import: it creates the deck row directly, under the same rules for id, title, description, and tags.

const NewDeckSchema = DeckMetaSchema.extend({ id: DeckMetaSchema.shape.id.optional() });

export type CreateDeckProblem =
	{ kind: 'invalid'; errors: FieldError[] } | { kind: 'conflict'; error: FieldError };

// The id a title gives, made unique among every deck, including the ones in the Trash (an id is the deck's
// identity, so one in the Trash is still taken). A number is added when needed and the whole id stays within the
// length limit.
function freeIdFor(x: Executor, title: string): string {
	const base = slugifyTitle(title);
	if (!getDeck(x, base)) return base;
	for (let n = 2; n < 1000; n++) {
		const suffix = `-${n}`;
		const candidate = `${base.slice(0, LIMITS.maxIdLength - suffix.length).replace(/-+$/, '')}${suffix}`;
		if (!getDeck(x, candidate)) return candidate;
	}
	// A thousand decks with one title. Not a case worth a nicer answer than a random one.
	return `${base.slice(0, 50).replace(/-+$/, '')}-${crypto.randomUUID().slice(0, 8)}`;
}

// A title is stored as it is typed minus the space around it, which is never meant.
function withTrimmedTitle(input: unknown): unknown {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
	const title = (input as { title?: unknown }).title;
	return typeof title === 'string' ? { ...input, title: title.trim() } : { ...input };
}

export function createDeck(
	db: Db,
	input: unknown,
	now: string
): Result<DeckRow, CreateDeckProblem> {
	const parsed = NewDeckSchema.safeParse(withTrimmedTitle(input));
	if (!parsed.success) return err({ kind: 'invalid', errors: fieldErrors(parsed.error) });
	const { id: given, title, description, tags } = parsed.data;

	return withTx(db, (tx) => {
		if (given !== undefined) {
			const existing = getDeck(tx, given);
			if (existing) {
				return err({
					kind: 'conflict',
					error: existing.archived
						? {
								path: 'id',
								code: 'id_in_trash',
								message: `A deck with the id "${given}" is in the Trash. Restore it, delete it for good, or pick another id.`
							}
						: {
								path: 'id',
								code: 'id_taken',
								message: `A deck with the id "${given}" already exists. Pick another id.`
							}
				});
			}
		}
		const id = given ?? freeIdFor(tx, title);
		upsertDeck(tx, { id, title, description, tags }, now);
		return ok(getDeck(tx, id)!);
	});
}
