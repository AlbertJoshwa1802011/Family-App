CREATE TABLE `money_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`monthly_income_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`tithe_percent` integer DEFAULT 10 NOT NULL,
	`children_giving_minor` integer DEFAULT 0 NOT NULL,
	`savings_goal_minor` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_money_plan_family` ON `money_plans` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_money_plan_family_user` ON `money_plans` (`family_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category_id` text,
	`interval` text DEFAULT 'monthly' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`day_of_month` integer,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_family_active` ON `recurring_expenses` (`family_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_recurring_created_by` ON `recurring_expenses` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `recurring_reminders_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_id` text NOT NULL,
	`user_id` text NOT NULL,
	`period_key` text NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_reminder` ON `recurring_reminders_log` (`recurring_id`,`user_id`,`period_key`,`channel`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`estimated_minor` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`priority` text DEFAULT 'want' NOT NULL,
	`url` text,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_family_status` ON `wishlist_items` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_created_by` ON `wishlist_items` (`created_by_user_id`);--> statement-breakpoint
ALTER TABLE `expense_categories` ADD `parent_id` text REFERENCES expense_categories(id);--> statement-breakpoint
CREATE INDEX `idx_expense_category_parent` ON `expense_categories` (`parent_id`);--> statement-breakpoint
ALTER TABLE `reminder_prefs` ADD `reminder_email` text;