// Database schema (ADR-001, ADR-002, ADR-003, architect decisions section 5).
// Self-contained on purpose: drizzle-kit loads this file directly to generate migrations.
// All timestamps are UTC ISO 8601 text. Booleans are stored as 0 or 1.
import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const emptyJsonArray = sql`'[]'`;

export const decks = sqliteTable('decks', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	description: text('description'),
	tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(emptyJsonArray),
	targetRetention: real('target_retention'),
	newPerDay: integer('new_per_day'),
	examDate: text('exam_date'),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const cards = sqliteTable(
	'cards',
	{
		pk: integer('pk').primaryKey({ autoIncrement: true }),
		deckId: text('deck_id')
			.notNull()
			.references(() => decks.id),
		key: text('key').notNull(),
		type: text('type', { enum: ['basic', 'cloze', 'typed', 'choice'] }).notNull(),
		// Type-specific authored fields (front, back, text, choices, ...), validated by core/schema.
		content: text('content', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(emptyJsonArray),
		source: text('source'),
		contentHash: text('content_hash').notNull(),
		// Index of the card in the imported file. Orders new cards.
		position: integer('position').notNull(),
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull()
	},
	(t) => [
		uniqueIndex('cards_deck_key_unique').on(t.deckId, t.key),
		index('cards_deck_position_idx').on(t.deckId, t.position),
		check('cards_type_check', sql`${t.type} in ('basic', 'cloze', 'typed', 'choice')`)
	]
);

// One row per schedulable review item: one for basic, typed, and choice cards (ordinal 0),
// and one per cloze number for cloze cards (ordinal = the cloze number).
export const cardState = sqliteTable(
	'card_state',
	{
		cardPk: integer('card_pk')
			.notNull()
			.references(() => cards.pk, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull(),
		due: text('due').notNull(),
		stability: real('stability').notNull().default(0),
		difficulty: real('difficulty').notNull().default(0),
		elapsedDays: integer('elapsed_days').notNull().default(0),
		scheduledDays: integer('scheduled_days').notNull().default(0),
		learningSteps: integer('learning_steps').notNull().default(0),
		reps: integer('reps').notNull().default(0),
		lapses: integer('lapses').notNull().default(0),
		// 0 New, 1 Learning, 2 Review, 3 Relearning (matches ts-fsrs State).
		phase: integer('phase').notNull().default(0),
		lastReview: text('last_review'),
		leech: integer('leech', { mode: 'boolean' }).notNull().default(false),
		buriedUntil: text('buried_until'),
		// Set when a cloze number is removed from a card, keeps its history but leaves the queue.
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.cardPk, t.ordinal] }),
		index('card_state_due_idx')
			.on(t.due)
			.where(sql`${t.archived} = 0`),
		index('card_state_phase_idx').on(t.phase),
		check('card_state_phase_check', sql`${t.phase} between 0 and 3`)
	]
);

// Append-only. The client supplies the id (a UUID) so a double submit is idempotent.
export const reviewLog = sqliteTable(
	'review_log',
	{
		id: text('id').primaryKey(),
		cardPk: integer('card_pk')
			.notNull()
			.references(() => cards.pk, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull(),
		mode: text('mode', { enum: ['review', 'cram'] }).notNull(),
		grade: integer('grade').notNull(),
		// State before the review, kept as columns so the FSRS optimizer and stats can query it.
		preDue: text('pre_due').notNull(),
		preStability: real('pre_stability').notNull(),
		preDifficulty: real('pre_difficulty').notNull(),
		preElapsedDays: integer('pre_elapsed_days').notNull(),
		preScheduledDays: integer('pre_scheduled_days').notNull(),
		preLearningSteps: integer('pre_learning_steps').notNull(),
		preReps: integer('pre_reps').notNull(),
		preLapses: integer('pre_lapses').notNull(),
		prePhase: integer('pre_phase').notNull(),
		preLastReview: text('pre_last_review'),
		// State after the review, so a replayed submission returns the same result. Null in cram mode.
		result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
		scheduledDays: integer('scheduled_days'),
		durationMs: integer('duration_ms'),
		typedAnswer: text('typed_answer'),
		reviewedAt: text('reviewed_at').notNull()
	},
	(t) => [
		index('review_log_card_idx').on(t.cardPk, t.reviewedAt),
		index('review_log_time_idx').on(t.reviewedAt),
		index('review_log_mode_time_idx').on(t.mode, t.reviewedAt),
		check('review_log_grade_check', sql`${t.grade} between 1 and 4`),
		check('review_log_mode_check', sql`${t.mode} in ('review', 'cram')`)
	]
);

// Values are JSON encoded, so numbers and booleans round trip.
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const importHistory = sqliteTable('import_history', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deckId: text('deck_id')
		.notNull()
		.references(() => decks.id),
	format: text('format', { enum: ['json', 'markdown'] }).notNull(),
	filename: text('filename'),
	newCount: integer('new_count').notNull(),
	updatedCount: integer('updated_count').notNull(),
	unchangedCount: integer('unchanged_count').notNull(),
	archivedCount: integer('archived_count').notNull(),
	createdAt: text('created_at').notNull()
});

// One row each time a deck is started over (US-14, ADR-013). The review log is kept, so this marks where the history
// of a card's schedule starts again: reviews before resetAt belong to the earlier run. A deck's rows go with it
// when it is deleted for good.
export const deckResets = sqliteTable('deck_resets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deckId: text('deck_id')
		.notNull()
		.references(() => decks.id),
	resetAt: text('reset_at').notNull(),
	// Review items put back to new.
	items: integer('items').notNull()
});

export type DeckRow = typeof decks.$inferSelect;
export type NewDeckRow = typeof decks.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;
export type CardStateRow = typeof cardState.$inferSelect;
export type NewCardStateRow = typeof cardState.$inferInsert;
export type ReviewLogRow = typeof reviewLog.$inferSelect;
export type NewReviewLogRow = typeof reviewLog.$inferInsert;
export type ImportHistoryRow = typeof importHistory.$inferSelect;
export type DeckResetRow = typeof deckResets.$inferSelect;
