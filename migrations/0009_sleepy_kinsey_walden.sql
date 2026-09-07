CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`emoji` text DEFAULT '📦' NOT NULL,
	`slug` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_expense_cat_family_parent` ON `expense_categories` (`family_id`,`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_cat_family_slug` ON `expense_categories` (`family_id`,`slug`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `category_id` text REFERENCES expense_categories(id);--> statement-breakpoint
CREATE INDEX `idx_expense_family_category` ON `expenses` (`family_id`,`category_id`);