ALTER TABLE `tasks` ADD `parent_task_id` text REFERENCES tasks(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `priority` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_task_parent` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_family_created` ON `tasks` (`family_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_family_priority` ON `tasks` (`family_id`,`priority`);