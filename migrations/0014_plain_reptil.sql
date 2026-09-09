CREATE TABLE `family_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`domain` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`emoji` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_family_label_domain` ON `family_labels` (`family_id`,`domain`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_family_label_domain_slug` ON `family_labels` (`family_id`,`domain`,`slug`);