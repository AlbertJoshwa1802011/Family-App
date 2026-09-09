CREATE TABLE `event_google_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`synced_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_google_sync_event` ON `event_google_sync` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_google_sync_user` ON `event_google_sync` (`event_id`,`user_id`);