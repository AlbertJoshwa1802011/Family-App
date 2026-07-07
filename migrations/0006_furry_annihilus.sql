ALTER TABLE `tasks` ADD `referred_task_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `subtasks_json` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reminder_date` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `remind_member_id` text REFERENCES family_members(id);