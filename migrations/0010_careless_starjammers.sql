CREATE TABLE `life_event_reminders_log` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurrence_year` integer NOT NULL,
	`window_days` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_life_event_reminder` ON `life_event_reminders_log` (`member_id`,`kind`,`occurrence_year`,`window_days`,`channel`);--> statement-breakpoint
ALTER TABLE `family_members` ADD `anniversary_date` text;