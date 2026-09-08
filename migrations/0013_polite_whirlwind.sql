ALTER TABLE `documents` ADD `calendar_reminder_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `expiry_reminder_event_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `source` text;