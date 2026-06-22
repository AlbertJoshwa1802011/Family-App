CREATE TABLE `occasion_recipients` (
	`occasion_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`occasion_id`, `member_id`),
	FOREIGN KEY (`occasion_id`) REFERENCES `occasions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `occasion_reminders_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occasion_id` text NOT NULL,
	`user_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`window_days` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`occasion_id`) REFERENCES `occasions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_occasion_reminder` ON `occasion_reminders_log` (`occasion_id`,`user_id`,`occurrence_date`,`window_days`,`channel`);--> statement-breakpoint
CREATE TABLE `occasions` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`recurring` integer DEFAULT true NOT NULL,
	`subject_member_id` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_occasion_family` ON `occasions` (`family_id`,`status`);