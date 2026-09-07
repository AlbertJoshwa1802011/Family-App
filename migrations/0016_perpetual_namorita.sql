-- Idempotent: production already has chat_messages from an earlier chat
-- restore (table present, migration not recorded). CREATE IF NOT EXISTS lets
-- this migration apply cleanly and record itself in d1_migrations.
CREATE TABLE IF NOT EXISTS `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_family_created` ON `chat_messages` (`family_id`,`created_at`);
