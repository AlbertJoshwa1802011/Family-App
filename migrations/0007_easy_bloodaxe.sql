CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_category_family_archived` ON `expense_categories` (`family_id`,`archived`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_category_name` ON `expense_categories` (`family_id`,`name`);--> statement-breakpoint
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
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_family_date` ON `expenses` (`family_id`,`expense_date`);--> statement-breakpoint
CREATE INDEX `idx_expense_family_status` ON `expenses` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_expense_created_by` ON `expenses` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `idx_expense_paid_by` ON `expenses` (`paid_by_member_id`);--> statement-breakpoint
CREATE INDEX `idx_expense_category` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_client_request` ON `expenses` (`family_id`,`created_by_user_id`,`client_request_id`);--> statement-breakpoint
ALTER TABLE `families` ADD `default_currency` text DEFAULT 'USD' NOT NULL;