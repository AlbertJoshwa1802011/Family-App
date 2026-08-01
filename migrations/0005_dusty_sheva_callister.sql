CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`emoji` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expcat_family_parent` ON `expense_categories` (`family_id`,`parent_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_expcat_family_status` ON `expense_categories` (`family_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expcat_family_slug` ON `expense_categories` (`family_id`,`slug`);--> statement-breakpoint
CREATE TABLE `expense_payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`emoji` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_exppm_family_status` ON `expense_payment_methods` (`family_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_exppm_family_slug` ON `expense_payment_methods` (`family_id`,`slug`);--> statement-breakpoint
CREATE TABLE `expense_settings` (
	`family_id` text PRIMARY KEY NOT NULL,
	`default_currency` text DEFAULT 'INR' NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`month_start_day` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`payer_member_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`spent_on` text NOT NULL,
	`spent_time` text,
	`category_id` text NOT NULL,
	`subcategory_id` text,
	`merchant` text,
	`merchant_key` text,
	`payment_method_id` text,
	`notes` text,
	`visibility` text DEFAULT 'family' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`trashed_at` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`external_account` text,
	`import_batch_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subcategory_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_method_id`) REFERENCES `expense_payment_methods`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_exp_amount_positive" CHECK("expenses"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_exp_family_date` ON `expenses` (`family_id`,`spent_on`);--> statement-breakpoint
CREATE INDEX `idx_exp_family_status_date` ON `expenses` (`family_id`,`status`,`spent_on`);--> statement-breakpoint
CREATE INDEX `idx_exp_family_cat_date` ON `expenses` (`family_id`,`category_id`,`spent_on`);--> statement-breakpoint
CREATE INDEX `idx_exp_family_merchant` ON `expenses` (`family_id`,`merchant_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_exp_external` ON `expenses` (`family_id`,`source`,`external_id`) WHERE "expenses"."external_id" is not null;