CREATE TABLE `fund_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fund_accounts_family_status` ON `fund_accounts` (`family_id`,`status`);--> statement-breakpoint
CREATE TABLE `fund_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fund_activity_fund_created` ON `fund_activity` (`fund_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fund_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`payer_name` text NOT NULL,
	`payer_member_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_at` integer NOT NULL,
	`note` text,
	`external_ref` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fund_contrib_fund_paid` ON `fund_contributions` (`fund_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_fund_contrib_family` ON `fund_contributions` (`family_id`);--> statement-breakpoint
CREATE TABLE `fund_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`period_key` text NOT NULL,
	`contributions_minor` integer NOT NULL,
	`spends_minor` integer NOT NULL,
	`remaining_minor` integer NOT NULL,
	`settled_at` integer NOT NULL,
	`settled_by_user_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fund_settlements_family` ON `fund_settlements` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fund_settlement_period` ON `fund_settlements` (`fund_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `fund_spends` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`spend_date` text NOT NULL,
	`merchant` text,
	`description` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fund_spends_fund_date` ON `fund_spends` (`fund_id`,`spend_date`);--> statement-breakpoint
CREATE INDEX `idx_fund_spends_family` ON `fund_spends` (`family_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `parent_expense_id` text REFERENCES expenses(id);--> statement-breakpoint
ALTER TABLE `expenses` ADD `nest_depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_expense_parent` ON `expenses` (`parent_expense_id`);