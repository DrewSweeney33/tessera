CREATE TABLE `card_state` (
	`card_pk` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`due` text NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`phase` integer DEFAULT 0 NOT NULL,
	`last_review` text,
	`leech` integer DEFAULT false NOT NULL,
	`buried_until` text,
	`archived` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`card_pk`, `ordinal`),
	FOREIGN KEY (`card_pk`) REFERENCES `cards`(`pk`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_state_phase_check" CHECK("card_state"."phase" between 0 and 3)
);
--> statement-breakpoint
CREATE INDEX `card_state_due_idx` ON `card_state` (`due`) WHERE "card_state"."archived" = 0;--> statement-breakpoint
CREATE INDEX `card_state_phase_idx` ON `card_state` (`phase`);--> statement-breakpoint
CREATE TABLE `cards` (
	`pk` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text,
	`content_hash` text NOT NULL,
	`position` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cards_type_check" CHECK("cards"."type" in ('basic', 'cloze', 'typed', 'choice'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_deck_key_unique` ON `cards` (`deck_id`,`key`);--> statement-breakpoint
CREATE INDEX `cards_deck_position_idx` ON `cards` (`deck_id`,`position`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`target_retention` real,
	`new_per_day` integer,
	`exam_date` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` text NOT NULL,
	`format` text NOT NULL,
	`filename` text,
	`new_count` integer NOT NULL,
	`updated_count` integer NOT NULL,
	`unchanged_count` integer NOT NULL,
	`archived_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` text PRIMARY KEY NOT NULL,
	`card_pk` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`mode` text NOT NULL,
	`grade` integer NOT NULL,
	`pre_due` text NOT NULL,
	`pre_stability` real NOT NULL,
	`pre_difficulty` real NOT NULL,
	`pre_elapsed_days` integer NOT NULL,
	`pre_scheduled_days` integer NOT NULL,
	`pre_learning_steps` integer NOT NULL,
	`pre_reps` integer NOT NULL,
	`pre_lapses` integer NOT NULL,
	`pre_phase` integer NOT NULL,
	`pre_last_review` text,
	`result` text,
	`scheduled_days` integer,
	`duration_ms` integer,
	`typed_answer` text,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`card_pk`) REFERENCES `cards`(`pk`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_log_grade_check" CHECK("review_log"."grade" between 1 and 4),
	CONSTRAINT "review_log_mode_check" CHECK("review_log"."mode" in ('review', 'cram'))
);
--> statement-breakpoint
CREATE INDEX `review_log_card_idx` ON `review_log` (`card_pk`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `review_log_time_idx` ON `review_log` (`reviewed_at`);--> statement-breakpoint
CREATE INDEX `review_log_mode_time_idx` ON `review_log` (`mode`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
