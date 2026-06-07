CREATE TABLE `event_reminders_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`window_days` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_reminder` ON `event_reminders_log` (`event_id`,`user_id`,`window_days`,`channel`);--> statement-breakpoint
ALTER TABLE `events` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `trashed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_event_family_status_start` ON `events` (`family_id`,`status`,`start_at`);