CREATE TABLE `resource_links` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`url` text,
	`title` text,
	`document_id` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_resource_link_target` ON `resource_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_link_family` ON `resource_links` (`family_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `events` ADD `travel_buffer_mins` integer;--> statement-breakpoint
ALTER TABLE `notes` ADD `event_id` text REFERENCES events(id);--> statement-breakpoint
CREATE INDEX `idx_note_event` ON `notes` (`event_id`);