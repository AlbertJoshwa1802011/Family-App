CREATE TABLE `location_points` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lat` text NOT NULL,
	`lng` text NOT NULL,
	`accuracy_m` integer,
	`speed_mps` text,
	`heading_deg` integer,
	`recorded_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_location_points_user_time` ON `location_points` (`family_id`,`user_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_location_points_family_time` ON `location_points` (`family_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `location_sharing_prefs` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_location_pref_family` ON `location_sharing_prefs` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_location_pref_family_user` ON `location_sharing_prefs` (`family_id`,`user_id`);