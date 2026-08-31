CREATE TABLE `category_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`monthly_limit_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_category_budget` ON `category_budgets` (`user_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `commitment_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`commitment_id` text NOT NULL,
	`period_key` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`expense_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_commitment_payment_due` ON `commitment_payments` (`due_date`,`paid`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_commitment_period` ON `commitment_payments` (`commitment_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`amount_kind` text DEFAULT 'fixed' NOT NULL,
	`amount_minor` integer,
	`percent_bp` integer,
	`currency` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer,
	`day_of_week` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`total_installments` integer,
	`category_id` text,
	`auto_log` integer DEFAULT false NOT NULL,
	`remind_days_before` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_commitment_family_owner` ON `commitments` (`family_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_commitment_status` ON `commitments` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_commitment_kind` ON `commitments` (`family_id`,`kind`);--> statement-breakpoint
CREATE TABLE `financial_settings` (
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`savings_target_kind` text DEFAULT 'none' NOT NULL,
	`savings_target_minor` integer,
	`savings_target_percent_bp` integer,
	`payday_day_of_month` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `family_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`label` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_income_family_owner` ON `incomes` (`family_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_income_active` ON `incomes` (`family_id`,`active`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`url` text,
	`estimated_cost_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`target_date` text,
	`category_id` text,
	`status` text DEFAULT 'wanted' NOT NULL,
	`purchased_expense_id` text,
	`purchased_at` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchased_expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_family_owner` ON `wishlist_items` (`family_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_status_priority` ON `wishlist_items` (`family_id`,`status`,`priority`);--> statement-breakpoint
DROP INDEX `uq_expense_category_name`;--> statement-breakpoint
ALTER TABLE `expense_categories` ADD `parent_category_id` text REFERENCES expense_categories(id);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_category_name` ON `expense_categories` (`family_id`,`parent_category_id`,`name`);--> statement-breakpoint
ALTER TABLE `reminder_prefs` ADD `reminder_email` text;--> statement-breakpoint
ALTER TABLE `reminder_prefs` ADD `digest_enabled` integer DEFAULT true NOT NULL;