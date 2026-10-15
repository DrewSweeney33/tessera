CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_name_unique` ON `folders` (lower("name"));--> statement-breakpoint
ALTER TABLE `decks` ADD `folder_id` integer REFERENCES folders(id) ON DELETE set null;