PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_family_members` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text,
	`member_type` text DEFAULT 'user' NOT NULL,
	`display_name` text,
	`date_of_birth` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- New columns (member_type/display_name/date_of_birth) did not exist on the old
-- table; copy only the original columns and let the new ones take their defaults.
INSERT INTO `__new_family_members`("id", "family_id", "user_id", "role", "status", "created_at") SELECT "id", "family_id", "user_id", "role", "status", "created_at" FROM `family_members`;--> statement-breakpoint
DROP TABLE `family_members`;--> statement-breakpoint
ALTER TABLE `__new_family_members` RENAME TO `family_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_member_user` ON `family_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_family_user` ON `family_members` (`family_id`,`user_id`);