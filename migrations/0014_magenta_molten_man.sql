CREATE TABLE `church_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`fund_slug` text NOT NULL,
	`period_key` text NOT NULL,
	`collected_minor` integer NOT NULL,
	`spent_minor` integer NOT NULL,
	`remaining_minor` integer NOT NULL,
	`settled_at` integer NOT NULL,
	`settled_by_user_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_church_settlements_family` ON `church_settlements` (`family_id`,`settled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_church_settlement_period` ON `church_settlements` (`family_id`,`fund_slug`,`period_key`);--> statement-breakpoint
ALTER TABLE `events` ADD `google_calendar_event_id` text;