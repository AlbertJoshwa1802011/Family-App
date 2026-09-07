CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notebook_family_sort` ON `notebooks` (`family_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`notebook_id` text,
	`owner_user_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`note_date` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_note_family_updated` ON `notes` (`family_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_note_notebook` ON `notes` (`notebook_id`);--> statement-breakpoint
CREATE INDEX `idx_note_family_owner` ON `notes` (`family_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_note_family_kind` ON `notes` (`family_id`,`kind`);