CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text,
	`parent_category_id` text,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_expense_category_family_archived` ON `expense_categories` (`family_id`,`archived`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_category_name` ON `expense_categories` (`family_id`,`parent_category_id`,`name`);--> statement-breakpoint
CREATE TABLE `expense_participants` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`share_minor` integer NOT NULL,
	`share_percent_bp` integer,
	PRIMARY KEY(`expense_id`, `member_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_expense_participant_member` ON `expense_participants` (`member_id`);--> statement-breakpoint
CREATE TABLE `expense_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_receipt_expense_status` ON `expense_receipts` (`expense_id`,`status`);--> statement-breakpoint
CREATE TABLE `expense_tags` (
	`expense_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`expense_id`, `tag_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_tag_tag` ON `expense_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`paid_by_member_id` text NOT NULL,
	`subject_member_id` text,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`expense_date` text NOT NULL,
	`merchant` text,
	`description` text,
	`payment_method` text,
	`split_type` text DEFAULT 'none' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`recurring_expense_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`trashed_at` integer,
	`created_by_user_id` text NOT NULL,
	`client_request_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_family_date` ON `expenses` (`family_id`,`expense_date`);--> statement-breakpoint
CREATE INDEX `idx_expense_family_status` ON `expenses` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_expense_paid_by` ON `expenses` (`paid_by_member_id`);--> statement-breakpoint
CREATE INDEX `idx_expense_category` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_client_request` ON `expenses` (`family_id`,`created_by_user_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `recurring_expense_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_expense_id` text NOT NULL,
	`period_key` text NOT NULL,
	`generated_expense_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generated_expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_expense_period` ON `recurring_expense_log` (`recurring_expense_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`paid_by_member_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`merchant` text,
	`description` text,
	`payment_method` text,
	`split_template_json` text DEFAULT '{"splitType":"none","participants":[]}' NOT NULL,
	`cadence` text NOT NULL,
	`day_of_week` integer,
	`day_of_month` integer,
	`interval_days` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`next_run_date` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_expense_due` ON `recurring_expenses` (`family_id`,`active`,`next_run_date`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`settled_at` integer NOT NULL,
	`note` text,
	`reverses_settlement_id` text,
	`recorded_by_user_id` text NOT NULL,
	`client_request_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_settlement_from` ON `settlements` (`family_id`,`from_member_id`);--> statement-breakpoint
CREATE INDEX `idx_settlement_to` ON `settlements` (`family_id`,`to_member_id`);--> statement-breakpoint
CREATE INDEX `idx_settlement_reverses` ON `settlements` (`reverses_settlement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_settlement_client_request` ON `settlements` (`family_id`,`recorded_by_user_id`,`client_request_id`);--> statement-breakpoint
ALTER TABLE `families` ADD `default_currency` text DEFAULT 'USD' NOT NULL;