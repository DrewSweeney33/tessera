CREATE TABLE `deck_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` text NOT NULL,
	`reset_at` text NOT NULL,
	`items` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE no action
);
